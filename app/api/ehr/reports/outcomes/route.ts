// app/api/ehr/reports/outcomes/route.ts
// Practice-wide outcome aggregates: mean/median PHQ-9 + GAD-7, share
// of patients showing reliable improvement (per RCI from lib/ehr/norms),
// distribution histogram of latest scores.

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireEhrAuth, isAuthError } from '@/lib/ehr/auth'
import { getNorm } from '@/lib/ehr/norms'

const INSTRUMENTS = ['PHQ-9', 'GAD-7', 'PCL-5', 'AUDIT-C'] as const

function median(arr: number[]): number | null {
  if (!arr.length) return null
  const sorted = [...arr].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export async function GET(_req: NextRequest) {
  const auth = await requireEhrAuth(); if (isAuthError(auth)) return auth

  // Pull completed assessments across the whole practice, all time.
  const { data: rows } = await supabaseAdmin
    .from('patient_assessments')
    .select('patient_id, assessment_type, score, completed_at')
    .eq('practice_id', auth.practiceId)
    .eq('status', 'completed')
    .order('completed_at', { ascending: true })
    .limit(5000)

  const byInstrument: Record<string, { baseline: Map<string, number>; latest: Map<string, number> }> = {}
  for (const inst of INSTRUMENTS) byInstrument[inst] = { baseline: new Map(), latest: new Map() }

  for (const r of rows ?? []) {
    const inst = r.assessment_type.toUpperCase().replace(/[^A-Z0-9-]/g, '')
    const normalized = inst === 'PHQ9' ? 'PHQ-9' : inst === 'GAD7' ? 'GAD-7' : inst === 'PCL5' ? 'PCL-5' : inst === 'AUDITC' ? 'AUDIT-C' : inst
    if (!byInstrument[normalized]) continue
    if (r.score == null) continue
    // Baseline = first, latest = last (rows are ASC)
    if (!byInstrument[normalized].baseline.has(r.patient_id)) {
      byInstrument[normalized].baseline.set(r.patient_id, r.score)
    }
    byInstrument[normalized].latest.set(r.patient_id, r.score)
  }

  const reports = INSTRUMENTS.map((inst) => {
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
    const improved = paired.filter((p) => p.delta <= -rci).length
    const worsened = paired.filter((p) => p.delta >= rci).length
    const stable = paired.length - improved - worsened

    // Distribution — bucket latest scores by the instrument's severity bands.
    const buckets: Array<{ label: string; count: number }> = []
    const max = inst === 'PHQ-9' ? 27 : inst === 'GAD-7' ? 21 : inst === 'PCL-5' ? 80 : 12
    const bins = inst === 'PHQ-9'
      ? [[0, 4, 'minimal'], [5, 9, 'mild'], [10, 14, 'moderate'], [15, 19, 'mod-severe'], [20, 27, 'severe']]
      : inst === 'GAD-7'
      ? [[0, 4, 'minimal'], [5, 9, 'mild'], [10, 14, 'moderate'], [15, 21, 'severe']]
      : inst === 'PCL-5'
      ? [[0, 30, 'below-threshold'], [31, 45, 'moderate'], [46, 80, 'severe']]
      : [[0, 2, 'low'], [3, 4, 'at-risk'], [5, 7, 'hazardous'], [8, 12, 'high']]
    for (const [lo, hi, label] of bins as Array<[number, number, string]>) {
      buckets.push({ label, count: latestScores.filter((s) => s >= lo && s <= hi).length })
    }

    return {
      instrument: inst,
      max,
      patient_count: bs.latest.size,
      mean: latestScores.length ? +(latestScores.reduce((a, b) => a + b, 0) / latestScores.length).toFixed(1) : null,
      median: median(latestScores),
      improved,
      stable,
      worsened,
      reliable_change_threshold: rci,
      distribution: buckets,
    }
  }).filter((r) => r.patient_count > 0)

  return NextResponse.json({ reports })
}
