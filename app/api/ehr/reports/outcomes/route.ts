// Practice-wide outcome aggregates: mean / median PHQ-9 + GAD-7 + PCL-5 +
// AUDIT-C, share of patients showing reliable improvement (per RCI from
// lib/ehr/norms — pure helper, no Supabase deps), distribution histogram of
// latest scores by severity band.

import { NextResponse } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { getNorm } from '@/lib/ehr/norms'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const INSTRUMENTS = ['PHQ-9', 'GAD-7', 'PCL-5', 'AUDIT-C'] as const
type Instrument = typeof INSTRUMENTS[number]

function median(arr: number[]): number | null {
  if (!arr.length) return null
  const sorted = [...arr].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export async function GET() {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  if (!ctx.practiceId) return NextResponse.json({ reports: [] })

  const { rows } = await pool
    .query(
      `SELECT patient_id, assessment_type, score, completed_at
         FROM patient_assessments
        WHERE practice_id = $1 AND status = 'completed'
        ORDER BY completed_at ASC LIMIT 5000`,
      [ctx.practiceId],
    )
    .catch(() => ({ rows: [] as any[] }))

  const byInstrument: Record<Instrument, {
    baseline: Map<string, number>
    latest: Map<string, number>
  }> = {
    'PHQ-9': { baseline: new Map(), latest: new Map() },
    'GAD-7': { baseline: new Map(), latest: new Map() },
    'PCL-5': { baseline: new Map(), latest: new Map() },
    'AUDIT-C': { baseline: new Map(), latest: new Map() },
  }

  for (const r of rows) {
    const inst = (r.assessment_type || '').toUpperCase().replace(/[^A-Z0-9-]/g, '')
    const norm: Instrument | null =
      inst === 'PHQ9' || inst === 'PHQ-9' ? 'PHQ-9' :
      inst === 'GAD7' || inst === 'GAD-7' ? 'GAD-7' :
      inst === 'PCL5' || inst === 'PCL-5' ? 'PCL-5' :
      inst === 'AUDITC' || inst === 'AUDIT-C' ? 'AUDIT-C' : null
    if (!norm || r.score == null) continue
    if (!byInstrument[norm].baseline.has(r.patient_id)) {
      byInstrument[norm].baseline.set(r.patient_id, r.score)
    }
    byInstrument[norm].latest.set(r.patient_id, r.score)
  }

  const reports = INSTRUMENTS.map((inst): any => {
    const bs = byInstrument[inst]
    const norm = getNorm(inst)
    const rci = norm?.reliable_change ?? 5
    const latestScores = Array.from(bs.latest.values())
    const paired: Array<{ patient_id: string; delta: number; latest: number }> = []
    for (const [pid, latest] of bs.latest) {
      const baseline = bs.baseline.get(pid)
      if (baseline == null) continue
      paired.push({ patient_id: pid, delta: latest - baseline, latest })
    }
    const improved = paired.filter(p => p.delta <= -rci).length
    const worsened = paired.filter(p => p.delta >= rci).length
    const stable = paired.length - improved - worsened

    const max = inst === 'PHQ-9' ? 27 : inst === 'GAD-7' ? 21 : inst === 'PCL-5' ? 80 : 12
    const bins: Array<[number, number, string]> =
      inst === 'PHQ-9'
        ? [[0, 4, 'minimal'], [5, 9, 'mild'], [10, 14, 'moderate'], [15, 19, 'mod-severe'], [20, 27, 'severe']]
        : inst === 'GAD-7'
        ? [[0, 4, 'minimal'], [5, 9, 'mild'], [10, 14, 'moderate'], [15, 21, 'severe']]
        : inst === 'PCL-5'
        ? [[0, 30, 'below-threshold'], [31, 45, 'moderate'], [46, 80, 'severe']]
        : [[0, 2, 'low'], [3, 4, 'at-risk'], [5, 7, 'hazardous'], [8, 12, 'high']]

    const distribution = bins.map(([lo, hi, label]) => ({
      label,
      count: latestScores.filter(s => s >= lo && s <= hi).length,
    }))

    return {
      instrument: inst,
      max,
      patient_count: bs.latest.size,
      mean: latestScores.length
        ? +(latestScores.reduce((a, b) => a + b, 0) / latestScores.length).toFixed(1)
        : null,
      median: median(latestScores),
      improved,
      stable,
      worsened,
      reliable_change_threshold: rci,
      distribution,
    }
  }).filter(r => r.patient_count > 0)

  return NextResponse.json({ reports })
}
