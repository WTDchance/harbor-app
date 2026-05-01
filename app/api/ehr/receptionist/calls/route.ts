// app/api/ehr/receptionist/calls/route.ts
//
// W50 D5 — list calls for the receptionist review dashboard with
// outcome bucketing + filters.

import { NextResponse, type NextRequest } from 'next/server'
import { requireReceptionApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const OUTCOME_FILTERS = new Set(['booked', 'cancelled_call', 'no_record_created', 'crisis_flagged', 'all'])

export async function GET(req: NextRequest) {
  const ctx = await requireReceptionApiSession()
  if (ctx instanceof NextResponse) return ctx

  const sp = req.nextUrl.searchParams
  const fromRaw = sp.get('from')
  const toRaw = sp.get('to')
  const outcomeFilter = OUTCOME_FILTERS.has(sp.get('outcome') ?? '') ? sp.get('outcome')! : 'all'
  const onlyCrisis = sp.get('crisis') === '1'
  const limit = Math.min(500, Number(sp.get('limit')) || 200)

  const args: any[] = [ctx.practiceId]
  let cond = 'practice_id = $1'
  if (fromRaw && /^\d{4}-\d{2}-\d{2}/.test(fromRaw)) { args.push(fromRaw); cond += ` AND created_at >= $${args.length}::date` }
  if (toRaw   && /^\d{4}-\d{2}-\d{2}/.test(toRaw))   { args.push(toRaw);   cond += ` AND created_at < ($${args.length}::date + INTERVAL '1 day')` }
  if (onlyCrisis) cond += ` AND inferred_crisis_risk = TRUE`

  const { rows } = await pool.query(
    `SELECT id, created_at, from_number, duration_seconds, summary, patient_id::text,
            inferred_crisis_risk, inferred_no_show_intent, inferred_reschedule_intent,
            CASE
              WHEN inferred_crisis_risk = TRUE THEN 'crisis_flagged'
              WHEN patient_id IS NOT NULL AND EXISTS (
                SELECT 1 FROM appointments a WHERE a.call_log_id = call_logs.id
              ) THEN 'booked'
              WHEN patient_id IS NULL THEN 'no_record_created'
              ELSE 'cancelled_call'
            END AS outcome,
            (SELECT array_agg(DISTINCT type)
               FROM patient_flags pf
              WHERE pf.patient_id = call_logs.patient_id
                AND pf.cleared_at IS NULL) AS patient_active_flags
       FROM call_logs
      WHERE ${cond}
      ORDER BY created_at DESC
      LIMIT ${limit}`,
    args,
  ).catch(() => ({ rows: [] as any[] }))

  const filtered = outcomeFilter === 'all' ? rows : rows.filter(r => r.outcome === outcomeFilter)

  await auditEhrAccess({
    ctx,
    action: 'receptionist.calls.list',
    resourceType: 'call_log',
    details: { count: filtered.length, outcome_filter: outcomeFilter, only_crisis: onlyCrisis },
  })

  return NextResponse.json({ calls: filtered })
}
