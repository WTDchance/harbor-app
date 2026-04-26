// app/api/admin/repair-practice/route.ts
//
// Wave 18 (AWS port). The "break glass" admin endpoint: read or patch
// ANY field on a practice row. Used when a practice was mis-created
// and needs surgical correction before re-provisioning.
//
// Auth: requireAdminSession() — Cognito session must match
// ADMIN_EMAIL allowlist.
//
// GET  ?practice_id=<uuid>        → returns full practices row
// POST { practice_id, ...fields } → patches supplied fields, returns
//                                    before + after (unrestricted —
//                                    admin already authenticated).
// PATCH                            → 501 STUB. Vapi/Twilio assistant
//                                    push is Bucket 1 (carrier swap;
//                                    Vapi is being replaced with
//                                    Retell + SignalWire).
//
// Audit captures admin email + practice_id + patched-keys + payload
// hash + before/after snapshots' SHA-256 hashes (so a post-hoc review
// can prove the row was in shape X before the patch and shape Y after,
// without storing PHI in audit_logs).

import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/aws/db'
import { requireAdminSession } from '@/lib/aws/api-auth'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
import { hashAdminPayload } from '@/lib/aws/admin/payload-hash'

export async function GET(req: NextRequest) {
  const ctx = await requireAdminSession()
  if (ctx instanceof NextResponse) return ctx

  const practiceId = req.nextUrl.searchParams.get('practice_id')
  if (!practiceId) {
    return NextResponse.json({ error: 'practice_id required' }, { status: 400 })
  }

  const { rows } = await pool.query(
    `SELECT * FROM practices WHERE id = $1 LIMIT 1`,
    [practiceId],
  )
  if (rows.length === 0) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  await auditEhrAccess({
    ctx,
    action: 'admin.repair_practice',
    resourceType: 'practice',
    resourceId: practiceId,
    details: { admin_email: ctx.session.email, action: 'read', target_practice_id: practiceId },
  })

  return NextResponse.json({ practice: rows[0] })
}

export async function POST(req: NextRequest) {
  const ctx = await requireAdminSession()
  if (ctx instanceof NextResponse) return ctx

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const practiceId = body.practice_id as string | undefined
  if (!practiceId) {
    return NextResponse.json({ error: 'practice_id required' }, { status: 400 })
  }

  // Snapshot before — used to build a diff hash for audit_logs.
  const beforeRes = await pool.query(
    `SELECT * FROM practices WHERE id = $1 LIMIT 1`,
    [practiceId],
  )
  if (beforeRes.rows.length === 0) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }
  const before = beforeRes.rows[0]

  const patch: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(body)) {
    if (key === 'practice_id') continue
    patch[key] = value
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'no fields supplied', before }, { status: 400 })
  }

  // Build dynamic UPDATE statement. We intentionally don't whitelist
  // columns here — admin authority is already verified via
  // requireAdminSession + the audit row records the diff.
  const keys = Object.keys(patch)
  const setClauses = keys.map((k, i) => `${k} = $${i + 2}`).join(', ')
  const values = [practiceId, ...keys.map((k) => patch[k])]

  let after: any
  try {
    const upd = await pool.query(
      `UPDATE practices SET ${setClauses} WHERE id = $1 RETURNING *`,
      values,
    )
    after = upd.rows[0]
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message, before }, { status: 500 })
  }

  await auditEhrAccess({
    ctx,
    action: 'admin.repair_practice',
    resourceType: 'practice',
    resourceId: practiceId,
    details: {
      admin_email: ctx.session.email,
      target_practice_id: practiceId,
      patched_keys: keys,
      payload_hash: hashAdminPayload(body),
      before_hash: hashAdminPayload(before),
      after_hash: hashAdminPayload(after),
    },
  })

  return NextResponse.json({ ok: true, patched_keys: keys, before, after })
}

/**
 * PATCH — Vapi assistant push / phone-number config sync.
 *
 * Stubbed for AWS port. The legacy version reaches into Vapi to:
 *   - sync system prompt / voice / greeting to the static assistant
 *   - flip phone-number config between dynamic and static assistantId
 *
 * Both behaviours belong to Bucket 1 (carrier swap) — Vapi is being
 * replaced with Retell + SignalWire. We intentionally don't port the
 * Vapi REST calls because they'd be deleted within the same migration.
 *
 * Returns 501 with a clear note so admin tooling fails loudly instead
 * of silently no-op'ing.
 */
export async function PATCH() {
  return NextResponse.json(
    {
      error: 'not_implemented',
      reason: 'carrier_swap_in_progress',
      detail:
        'Vapi assistant sync moved to Bucket 1 (Retell + SignalWire migration). ' +
        'Use the carrier-side admin tooling once that lands.',
    },
    { status: 501 },
  )
}
