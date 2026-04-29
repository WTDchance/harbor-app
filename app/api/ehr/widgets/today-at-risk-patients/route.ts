// W49 D6 — patients with risk flags scheduled today.

import { NextResponse } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const { rows } = await pool.query(
    `SELECT DISTINCT p.id, p.first_name, p.last_name,
            COALESCE(
              (SELECT array_agg(DISTINCT type)
                 FROM patient_flags pf
                WHERE pf.practice_id = p.practice_id
                  AND pf.patient_id = p.id
                  AND pf.cleared_at IS NULL
                  AND pf.type IN ('suicide_risk', 'no_show_risk', 'payment_risk')),
              '{}'::text[]
            ) AS active_flags,
            a.scheduled_for
       FROM patients p
       JOIN appointments a ON a.patient_id = p.id
      WHERE p.practice_id = $1
        AND DATE(a.scheduled_for) = CURRENT_DATE
        AND EXISTS (SELECT 1 FROM patient_flags pf2
                     WHERE pf2.practice_id = p.practice_id
                       AND pf2.patient_id = p.id
                       AND pf2.cleared_at IS NULL
                       AND pf2.type IN ('suicide_risk', 'no_show_risk', 'payment_risk'))
      ORDER BY a.scheduled_for ASC
      LIMIT 20`,
    [ctx.practiceId],
  ).catch(() => ({ rows: [] as any[] }))

  return NextResponse.json({ patients: rows })
}
