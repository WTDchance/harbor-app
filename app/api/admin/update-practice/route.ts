// app/api/admin/update-practice/route.ts
//
// Wave 18 (AWS port). Admin-only: patch editable fields on a practice
// row. Differs from /api/admin/repair-practice in that this endpoint
// has a hard-coded ALLOWED_KEYS whitelist — callers cannot use it to
// overwrite vapi_*, stripe_*, twilio_*, status, or subscription_*
// columns. (Use repair-practice for that.)
//
// Auth: requireAdminSession() — Cognito session must match
// ADMIN_EMAIL allowlist.
//
// POST {
//   practice_id: string,
//   name?: string
//   therapist_name?: string
//   therapist_phone?: string
//   owner_phone?: string
//   notification_email? | owner_email?: string
//   ai_name?: string
//   telehealth?: boolean
//   specialties?: string[]
// }
//
// Schema mapping: notification_email → owner_email on AWS canonical.
// Callers may still send notification_email for backward compat — we
// rewrite it server-side.

import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/aws/db'
import { requireAdminSession } from '@/lib/aws/api-auth'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
import { hashAdminPayload } from '@/lib/aws/admin/payload-hash'

const ALLOWED_KEYS = [
  'name',
  'therapist_name',
  'therapist_phone',
  'owner_phone',
  'owner_email',
  'ai_name',
  'telehealth',
  'specialties',
] as const

export async function POST(req: NextRequest) {
  const ctx = await requireAdminSession()
  if (ctx instanceof NextResponse) return ctx

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const practice_id = body.practice_id
  if (typeof practice_id !== 'string' || !practice_id) {
    return NextResponse.json({ error: 'practice_id is required' }, { status: 400 })
  }

  // Backward compat: notification_email → owner_email
  if ('notification_email' in body && !('owner_email' in body)) {
    body.owner_email = body.notification_email
  }

  const patch: Record<string, unknown> = {}
  for (const key of ALLOWED_KEYS) {
    if (key in body) patch[key] = body[key]
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { error: 'no allowed fields supplied', allowed: ALLOWED_KEYS },
      { status: 400 },
    )
  }

  const keys = Object.keys(patch)
  const setClauses = keys.map((k, i) => `${k} = $${i + 2}`).join(', ')
  const values = [practice_id, ...keys.map((k) => patch[k])]

  let after: any
  try {
    const upd = await pool.query(
      `UPDATE practices SET ${setClauses} WHERE id = $1 RETURNING *`,
      values,
    )
    if (upd.rows.length === 0) {
      return NextResponse.json({ error: 'practice not found' }, { status: 404 })
    }
    after = upd.rows[0]
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }

  await auditEhrAccess({
    ctx,
    action: 'admin.update_practice',
    resourceType: 'practice',
    resourceId: practice_id,
    details: {
      admin_email: ctx.session.email,
      target_practice_id: practice_id,
      patched_keys: keys,
      payload_hash: hashAdminPayload(body),
    },
  })

  return NextResponse.json({ ok: true, patched: keys, practice: after })
}
