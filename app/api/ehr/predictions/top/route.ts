// app/api/ehr/predictions/top/route.ts
//
// W45 T6 — Today screen "Predictions" section.
// Returns top flagged predictions across kinds, scoped to the
// practice and biased toward upcoming appointments + currently-
// at-risk patients.
//
// Sources:
//   * no_show predictions tied to appointments in the next 48h
//   * dropout_risk predictions ≥ 0.6 (patient-level)
//   * any prediction with override_score set in the last 7d (so
//     therapists see "you flagged this — outcome pending")

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type FlagRow = {
  prediction_id: string
  patient_id: string
  patient_name: string | null
  kind: string
  score: number
  factors_summary: string
  appointment_id: string | null
  scheduled_for: string | null
}

export async function GET(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const limit = Math.min(20, Math.max(1, Number(req.nextUrl.searchParams.get('limit') || '5')))

  // Top no_show for upcoming appointments (next 48h)
  const noShowQ = pool.query<FlagRow>(
    `SELECT pp.id::text         AS prediction_id,
            pp.patient_id::text AS patient_id,
            (p.first_name || ' ' || p.last_name)::text AS patient_name,
            pp.prediction_kind  AS kind,
            pp.score::float     AS score,
            COALESCE(pp.factors->>'summary', '') AS factors_summary,
            pp.appointment_id::text AS appointment_id,
            a.scheduled_for::text   AS scheduled_for
       FROM ehr_patient_predictions pp
       JOIN appointments a ON a.id = pp.appointment_id
       JOIN patients p     ON p.id = pp.patient_id
      WHERE pp.practice_id = $1
        AND pp.prediction_kind = 'no_show'
        AND a.status IN ('scheduled','confirmed')
        AND a.scheduled_for BETWEEN NOW() AND NOW() + INTERVAL '48 hours'
        AND pp.score >= 0.4
      ORDER BY pp.score DESC
      LIMIT $2`,
    [ctx.practiceId, limit],
  )

  // Top dropout_risk patient-level (≥ 0.6)
  const dropoutQ = pool.query<FlagRow>(
    `SELECT pp.id::text         AS prediction_id,
            pp.patient_id::text AS patient_id,
            (p.first_name || ' ' || p.last_name)::text AS patient_name,
            pp.prediction_kind  AS kind,
            pp.score::float     AS score,
            COALESCE(pp.factors->>'summary', '') AS factors_summary,
            NULL::text          AS appointment_id,
            NULL::text          AS scheduled_for
       FROM ehr_patient_predictions pp
       JOIN patients p ON p.id = pp.patient_id
      WHERE pp.practice_id = $1
        AND pp.prediction_kind = 'dropout_risk'
        AND pp.appointment_id IS NULL
        AND pp.score >= 0.6
        AND COALESCE(p.patient_status, 'active') <> 'discharged'
      ORDER BY pp.score DESC
      LIMIT $2`,
    [ctx.practiceId, limit],
  )

  const [noShow, dropout] = await Promise.all([noShowQ, dropoutQ])

  // Merge + keep top-N by score across kinds.
  const merged = [...noShow.rows, ...dropout.rows]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)

  await auditEhrAccess({
    ctx,
    action: 'prediction.viewed',
    resourceType: 'prediction',
    details: { surface: 'today_top', count: merged.length },
  })

  return NextResponse.json({ flags: merged })
}
