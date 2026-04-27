// app/api/ehr/reengagement/campaigns/route.ts
//
// W43 T4 — list + create per-practice re-engagement campaigns.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const { rows } = await pool.query(
    `SELECT id, name, inactive_days, channel, subject, body,
            active, created_at, updated_at
       FROM ehr_reengagement_campaigns
      WHERE practice_id = $1
      ORDER BY active DESC, created_at DESC`,
    [ctx.practiceId],
  )
  return NextResponse.json({ campaigns: rows })
}

export async function POST(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'invalid_json' }, { status: 400 })

  const name = String(body.name || '').trim()
  const messageBody = String(body.body || '').trim()
  const inactiveDays = Math.max(14, Math.min(730, parseInt(body.inactive_days || '90', 10) || 90))
  const channel = ['email', 'sms', 'patient_choice'].includes(body.channel) ? body.channel : 'email'
  const subject = body.subject ? String(body.subject) : null
  const active = body.active !== false

  if (!name || !messageBody) {
    return NextResponse.json({ error: 'name and body required' }, { status: 400 })
  }

  const ins = await pool.query(
    `INSERT INTO ehr_reengagement_campaigns
       (practice_id, name, inactive_days, channel, subject, body, active, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, name, inactive_days, channel, subject, body, active, created_at, updated_at`,
    [ctx.practiceId, name, inactiveDays, channel, subject, messageBody, active, ctx.userId],
  )

  await auditEhrAccess({
    ctx,
    action: 'reengagement.campaign_created',
    resourceType: 'ehr_reengagement_campaign',
    resourceId: ins.rows[0].id,
    details: { inactive_days: inactiveDays, channel, active },
  })

  return NextResponse.json({ campaign: ins.rows[0] }, { status: 201 })
}
