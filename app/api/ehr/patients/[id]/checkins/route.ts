// app/api/ehr/patients/[id]/checkins/route.ts
//
// W46 T5 — therapist read of a patient's daily check-ins. Returns the
// last `days` (default 30) of rows shaped for a heatmap.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const days = Math.max(7, Math.min(180, Number(req.nextUrl.searchParams.get('days') || '30')))

  const pCheck = await pool.query(
    `SELECT id, daily_checkin_reminder_enabled,
            daily_checkin_reminder_local_time
       FROM patients WHERE id = $1 AND practice_id = $2 LIMIT 1`,
    [params.id, ctx.practiceId],
  )
  if (pCheck.rows.length === 0) {
    return NextResponse.json({ error: 'patient_not_found' }, { status: 404 })
  }

  const { rows } = await pool.query(
    `SELECT (created_at AT TIME ZONE 'UTC')::date::text AS day,
            mood_score, symptoms, note, prompted_via
       FROM ehr_daily_checkins
      WHERE practice_id = $1 AND patient_id = $2
        AND created_at >= NOW() - ($3::int * INTERVAL '1 day')
      ORDER BY created_at DESC`,
    [ctx.practiceId, params.id, days],
  )

  await auditEhrAccess({
    ctx,
    action: 'patient_checkin.viewed_trend',
    resourceType: 'ehr_daily_checkin',
    resourceId: params.id,
    details: { range_days: days, sample: rows.length },
  })

  return NextResponse.json({
    days,
    checkins: rows,
    reminder_enabled: pCheck.rows[0].daily_checkin_reminder_enabled,
    reminder_local_time: pCheck.rows[0].daily_checkin_reminder_local_time,
  })
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'invalid_json' }, { status: 400 })

  const fields: string[] = []
  const args: any[] = []
  if (typeof body.reminder_enabled === 'boolean') {
    args.push(body.reminder_enabled); fields.push(`daily_checkin_reminder_enabled = $${args.length}`)
  }
  if (body.reminder_local_time !== undefined) {
    const v = body.reminder_local_time && /^\d{2}:\d{2}$/.test(body.reminder_local_time)
      ? body.reminder_local_time : null
    args.push(v); fields.push(`daily_checkin_reminder_local_time = $${args.length}`)
  }
  if (fields.length === 0) return NextResponse.json({ error: 'no_fields' }, { status: 400 })

  args.push(params.id, ctx.practiceId)
  const { rowCount } = await pool.query(
    `UPDATE patients SET ${fields.join(', ')}
      WHERE id = $${args.length - 1} AND practice_id = $${args.length}`,
    args,
  )
  if (rowCount === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  await auditEhrAccess({
    ctx,
    action: 'patient_checkin.reminder_pref_updated',
    resourceType: 'patient',
    resourceId: params.id,
    details: { fields_changed: fields.length },
  })
  return NextResponse.json({ ok: true })
}
