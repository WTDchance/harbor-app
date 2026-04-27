// app/api/ehr/patients/[id]/recent-diagnoses/route.ts
//
// Wave 31b — "Recently used in your practice" section of the smart
// diagnosis picker. Returns ICD-10 codes that have appeared on this
// practice's signed notes or active treatment plans in the last 90
// days, ordered by recency.
//
// GET → { codes: string[] }
//
// Note: aggregation is small (we cap to ~30 distinct codes) so we
// just run the query inline rather than caching.

import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/aws/db'
import { requireEhrApiSession } from '@/lib/aws/api-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, _: { params: Promise<{ id: string }> }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  if (!ctx.practiceId) return NextResponse.json({ codes: [] })

  // Pull from active treatment plans + recent signed notes' icd10_codes
  const sql = `
    WITH plan_codes AS (
      SELECT UNNEST(diagnoses) AS code, updated_at
        FROM ehr_treatment_plans
       WHERE practice_id = $1
         AND status = 'active'
         AND diagnoses IS NOT NULL
         AND updated_at > NOW() - INTERVAL '90 days'
    ),
    note_codes AS (
      SELECT UNNEST(icd10_codes) AS code, signed_at AS updated_at
        FROM ehr_progress_notes
       WHERE practice_id = $1
         AND status IN ('signed', 'amended')
         AND icd10_codes IS NOT NULL
         AND signed_at > NOW() - INTERVAL '90 days'
    ),
    combined AS (
      SELECT code, MAX(updated_at) AS most_recent
        FROM (SELECT * FROM plan_codes UNION ALL SELECT * FROM note_codes) u
       WHERE code IS NOT NULL AND code <> ''
       GROUP BY code
    )
    SELECT code FROM combined ORDER BY most_recent DESC LIMIT 30;
  `

  try {
    const { rows } = await pool.query(sql, [ctx.practiceId])
    return NextResponse.json({ codes: rows.map(r => r.code) })
  } catch (err) {
    // Schema gaps (icd10_codes column missing on either table) — quiet fallback
    return NextResponse.json({ codes: [] })
  }
}
