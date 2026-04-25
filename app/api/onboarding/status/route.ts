// Harbor — Onboarding checklist status (Cognito + RDS)

import { NextResponse } from 'next/server'
import { requireApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const ctx = await requireApiSession()
  if (ctx instanceof NextResponse) return ctx
  if (!ctx.practiceId) {
    return NextResponse.json({ steps: [], completedCount: 0, totalCount: 0, dismissed: false })
  }

  // Compute step status from a few quick queries
  const { rows: pr } = await pool.query(
    `SELECT
       p.id,
       (p.greeting IS NOT NULL AND length(p.greeting) > 0) AS has_greeting,
       (p.twilio_phone_number IS NOT NULL OR p.signalwire_number IS NOT NULL) AS has_phone,
       p.provisioning_state = 'active' AS is_active,
       EXISTS(SELECT 1 FROM calendar_connections cc WHERE cc.practice_id = p.id AND cc.status = 'active') AS has_calendar,
       EXISTS(SELECT 1 FROM call_logs cl WHERE cl.practice_id = p.id LIMIT 1) AS has_first_call
     FROM practices p WHERE p.id = $1`,
    [ctx.practiceId],
  )
  const r = pr[0] ?? {}
  const steps = [
    { key: 'phone',    label: 'Phone provisioned',    done: !!r.has_phone },
    { key: 'greeting', label: 'Greeting customised',  done: !!r.has_greeting },
    { key: 'calendar', label: 'Calendar connected',   done: !!r.has_calendar },
    { key: 'first_call', label: 'First call answered', done: !!r.has_first_call },
    { key: 'active',   label: 'Practice active',      done: !!r.is_active },
  ]
  const completedCount = steps.filter(s => s.done).length

  return NextResponse.json({ steps, completedCount, totalCount: steps.length, dismissed: false })
}
