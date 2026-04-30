// W52 D2 — read / upsert practice assessment config.
import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const r = await pool.query(
    `SELECT practice_id, intake_assessments, call_administered_assessments,
            recurring_assessments, crisis_routing, updated_at
       FROM practice_assessment_config WHERE practice_id = $1`,
    [ctx.practiceId],
  )
  return NextResponse.json({ config: r.rows[0] ?? null })
}

export async function PUT(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const body = await req.json().catch(() => null) as Record<string, any> | null
  if (!body) return NextResponse.json({ error: 'invalid_json' }, { status: 400 })

  const intake = Array.isArray(body.intake_assessments) ? body.intake_assessments : []
  const inCall = Array.isArray(body.call_administered_assessments) ? body.call_administered_assessments : ['phq-2','gad-2']
  const recurring = Array.isArray(body.recurring_assessments) ? body.recurring_assessments : []

  const upsert = await pool.query(
    `INSERT INTO practice_assessment_config
       (practice_id, intake_assessments, call_administered_assessments,
        recurring_assessments, crisis_routing)
     VALUES ($1, $2::text[], $3::text[], $4::jsonb, $5)
     ON CONFLICT (practice_id) DO UPDATE SET
       intake_assessments = EXCLUDED.intake_assessments,
       call_administered_assessments = EXCLUDED.call_administered_assessments,
       recurring_assessments = EXCLUDED.recurring_assessments,
       crisis_routing = EXCLUDED.crisis_routing
     RETURNING practice_id, intake_assessments, call_administered_assessments,
               recurring_assessments, crisis_routing, updated_at`,
    [ctx.practiceId, intake, inCall, JSON.stringify(recurring),
     body.crisis_routing ?? 'flag_and_alert'],
  )
  await auditEhrAccess({ ctx, action: 'practice_settings.updated', resourceType: 'practice_assessment_config' })
  return NextResponse.json({ config: upsert.rows[0] })
}
