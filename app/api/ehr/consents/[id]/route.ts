// app/api/ehr/consents/[id]/route.ts
//
// Wave 22 (AWS port). Sign / revoke an existing consent. Note: the
// patient-portal signing path with signature_hash lives at
// /api/portal/consents/[id]/sign (Wave 16); this route is the
// staff-side sign-on-paper / revoke surface.

import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/aws/db'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const { id } = await params
  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  let sql: string
  let args: any[]
  if (body.action === 'sign') {
    sql = `UPDATE ehr_consents
              SET status = 'signed',
                  signed_at = NOW(),
                  signed_by_name = $3,
                  signed_method = $4
            WHERE id = $1 AND practice_id = $2
            RETURNING *`
    args = [id, ctx.practiceId, body.signed_by_name || 'Patient', body.signed_method || 'in_person']
  } else if (body.action === 'revoke') {
    sql = `UPDATE ehr_consents
              SET status = 'revoked',
                  revoked_at = NOW(),
                  revoked_reason = $3
            WHERE id = $1 AND practice_id = $2
            RETURNING *`
    args = [id, ctx.practiceId, body.revoked_reason ?? null]
  } else {
    return NextResponse.json({ error: 'action must be "sign" or "revoke"' }, { status: 400 })
  }

  try {
    const { rows } = await pool.query(sql, args)
    if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await auditEhrAccess({
      ctx,
      action: body.action === 'sign' ? 'consent.sign' : 'note.update',
      resourceType: 'ehr_consent',
      resourceId: id,
      details: { kind: 'consent', action: body.action },
    })
    return NextResponse.json({ consent: rows[0] })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
