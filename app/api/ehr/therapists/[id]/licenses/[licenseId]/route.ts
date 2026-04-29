// app/api/ehr/therapists/[id]/licenses/[licenseId]/route.ts
//
// W49 D3 — update / delete one license.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
import { LICENSE_STATUSES, normaliseState } from '@/lib/ehr/credentialing'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string; licenseId: string }> }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id: therapistId, licenseId } = await params

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'invalid_json' }, { status: 400 })

  const sets: string[] = []
  const args: any[] = []

  for (const [k, v] of [['type', body.type], ['license_number', body.license_number], ['document_url', body.document_url], ['notes', body.notes]] as [string, unknown][]) {
    if (v !== undefined) {
      args.push(v == null ? null : String(v).slice(0, 1000))
      sets.push(`${k} = $${args.length}`)
    }
  }
  if (body.state !== undefined) {
    const s = normaliseState(body.state)
    if (!s) return NextResponse.json({ error: 'invalid_state' }, { status: 400 })
    args.push(s); sets.push(`state = $${args.length}`)
  }
  for (const k of ['issued_at', 'expires_at']) {
    const v = (body as any)[k]
    if (v !== undefined) {
      args.push(v || null); sets.push(`${k} = $${args.length}`)
    }
  }
  if (body.status !== undefined) {
    if (!LICENSE_STATUSES.includes(body.status)) return NextResponse.json({ error: 'invalid_status' }, { status: 400 })
    args.push(body.status); sets.push(`status = $${args.length}`)
  }

  if (sets.length === 0) return NextResponse.json({ error: 'no_changes' }, { status: 400 })
  args.push(licenseId, therapistId, ctx.practiceId)

  const upd = await pool.query(
    `UPDATE therapist_licenses
        SET ${sets.join(', ')}
      WHERE id = $${args.length - 2} AND therapist_id = $${args.length - 1} AND practice_id = $${args.length}
      RETURNING id, type, state, license_number, issued_at, expires_at, status,
                document_url, notes, last_warning_threshold, created_at, updated_at`,
    args,
  )
  if (upd.rows.length === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  await auditEhrAccess({
    ctx, action: 'credential.license.update',
    resourceType: 'therapist_license', resourceId: licenseId,
    details: { therapist_id: therapistId },
  })

  return NextResponse.json({ license: upd.rows[0] })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; licenseId: string }> }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id: therapistId, licenseId } = await params

  const del = await pool.query(
    `DELETE FROM therapist_licenses
      WHERE id = $1 AND therapist_id = $2 AND practice_id = $3
      RETURNING id`,
    [licenseId, therapistId, ctx.practiceId],
  )
  if (del.rows.length === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  await auditEhrAccess({
    ctx, action: 'credential.license.delete',
    resourceType: 'therapist_license', resourceId: licenseId,
  })

  return NextResponse.json({ ok: true })
}
