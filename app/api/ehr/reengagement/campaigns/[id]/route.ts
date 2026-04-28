// app/api/ehr/reengagement/campaigns/[id]/route.ts

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'invalid_json' }, { status: 400 })

  const fields: string[] = []
  const args: any[] = []

  if (body.name !== undefined) { args.push(String(body.name)); fields.push(`name = $${args.length}`) }
  if (body.subject !== undefined) { args.push(body.subject ? String(body.subject) : null); fields.push(`subject = $${args.length}`) }
  if (body.body !== undefined) { args.push(String(body.body)); fields.push(`body = $${args.length}`) }
  if (body.inactive_days !== undefined) {
    const n = Math.max(14, Math.min(730, parseInt(String(body.inactive_days), 10) || 90))
    args.push(n); fields.push(`inactive_days = $${args.length}`)
  }
  if (body.channel !== undefined && ['email','sms','patient_choice'].includes(body.channel)) {
    args.push(body.channel); fields.push(`channel = $${args.length}`)
  }
  if (body.active !== undefined) { args.push(!!body.active); fields.push(`active = $${args.length}`) }

  if (fields.length === 0) return NextResponse.json({ error: 'no fields' }, { status: 400 })

  args.push(params.id, ctx.practiceId)
  const { rows } = await pool.query(
    `UPDATE ehr_reengagement_campaigns SET ${fields.join(', ')}
      WHERE id = $${args.length - 1} AND practice_id = $${args.length}
      RETURNING id, name, inactive_days, channel, subject, body, active, created_at, updated_at`,
    args,
  )
  if (rows.length === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  await auditEhrAccess({
    ctx,
    action: 'reengagement.campaign_updated',
    resourceType: 'ehr_reengagement_campaign',
    resourceId: params.id,
    details: { fields_changed: fields.length },
  })
  return NextResponse.json({ campaign: rows[0] })
}
