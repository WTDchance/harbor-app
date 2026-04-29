// components/ehr/PatientRiskChips.tsx
//
// W50 D3 — Low/Medium/High risk-chip indicators on patient detail.
// Hover/title shows the underlying score.

'use client'

import { useEffect, useState } from 'react'

interface Prediction {
  no_show_prob: number | string
  dropout_prob: number | string
  payment_risk_score: number | string
  churn_score: number | string
  composite_severity: 'low' | 'medium' | 'high'
  computed_at: string
}

type Score = { label: string; pct: number; tier: 'low' | 'medium' | 'high' }

function tierForPct(p: number): 'low' | 'medium' | 'high' {
  if (p >= 70) return 'high'
  if (p >= 40) return 'medium'
  return 'low'
}

export default function PatientRiskChips({ patientId }: { patientId: string }) {
  const [pred, setPred] = useState<Prediction | null | undefined>(undefined)
  useEffect(() => {
    let cancelled = false
    fetch(`/api/ehr/patients/${patientId}/prediction`)
      .then(r => r.ok ? r.json() : { prediction: null })
      .then(j => { if (!cancelled) setPred(j.prediction) })
      .catch(() => { if (!cancelled) setPred(null) })
    return () => { cancelled = true }
  }, [patientId])

  if (pred === undefined) return <span className="text-xs text-gray-400">…</span>
  if (!pred) return <span className="text-xs text-gray-400">No prediction yet</span>

  const scores: Score[] = [
    { label: 'No-show', pct: Math.round(Number(pred.no_show_prob) * 100), tier: tierForPct(Number(pred.no_show_prob) * 100) },
    { label: 'Dropout', pct: Math.round(Number(pred.dropout_prob) * 100), tier: tierForPct(Number(pred.dropout_prob) * 100) },
    { label: 'Payment', pct: Math.round(Number(pred.payment_risk_score) * 100), tier: tierForPct(Number(pred.payment_risk_score) * 100) },
    { label: 'Churn',   pct: Math.round(Number(pred.churn_score) * 100), tier: tierForPct(Number(pred.churn_score) * 100) },
  ]

  const tierClass = (t: Score['tier']) => t === 'high'
    ? 'border-red-300 bg-red-50 text-red-700'
    : t === 'medium'
    ? 'border-amber-300 bg-amber-50 text-amber-700'
    : 'border-gray-200 bg-gray-50 text-gray-600'

  const ts = new Date(pred.computed_at).toLocaleString()

  return (
    <div className="flex items-center gap-1.5 flex-wrap" title={`Computed ${ts}`}>
      {scores.map(s => (
        <span key={s.label}
          title={`${s.label}: ${s.pct}% — ${s.tier}`}
          className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border ${tierClass(s.tier)}`}>
          {s.label} · {s.tier}
        </span>
      ))}
    </div>
  )
}
