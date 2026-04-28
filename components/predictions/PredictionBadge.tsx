// components/predictions/PredictionBadge.tsx
//
// W45 T6 — small prediction-score badge with traffic-light tone +
// percent. Tap to expand factors (uses PredictionFactorsCard below).

'use client'

import { useState } from 'react'

export type Tone = 'green' | 'yellow' | 'red' | 'gray'

export function toneFor(score: number, kind: 'no_show' | 'dropout_risk' | 'engagement_score' | string): Tone {
  // For "bad" outcomes (no_show, dropout_risk), high score = red.
  // For engagement, invert.
  let bad = score
  if (kind === 'engagement_score') bad = 1 - score
  if (bad >= 0.6) return 'red'
  if (bad >= 0.3) return 'yellow'
  return 'green'
}

const TONES: Record<Tone, string> = {
  green:  'bg-green-100 text-green-800 border-green-200',
  yellow: 'bg-amber-100 text-amber-800 border-amber-200',
  red:    'bg-red-100 text-red-800 border-red-200',
  gray:   'bg-gray-100 text-gray-700 border-gray-200',
}

export interface PredictionFactor {
  name: string
  label?: string
  weight: number
  value: string | number | null
  normalized_score: number
}

export interface PredictionBadgeProps {
  label: string
  score: number
  kind: 'no_show' | 'dropout_risk' | 'engagement_score' | string
  factorsSummary?: string
  /** Pass full factors[] to enable the expand-on-tap drawer. */
  factors?: PredictionFactor[]
  /** Compact = pill; full = pill + summary line. */
  compact?: boolean
}

export function PredictionBadge({
  label, score, kind, factorsSummary, factors, compact,
}: PredictionBadgeProps) {
  const [open, setOpen] = useState(false)
  const tone = toneFor(score, kind)
  const pct = `${Math.round(score * 100)}%`

  const pill = (
    <button
      onClick={() => factors && setOpen(!open)}
      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full border text-xs font-medium ${TONES[tone]} ${factors ? 'cursor-pointer' : 'cursor-default'}`}
    >
      <span className="font-semibold">{pct}</span>
      <span className="opacity-80">{label}</span>
    </button>
  )

  if (compact) return pill

  return (
    <div className="space-y-1">
      {pill}
      {factorsSummary && (
        <div className="text-xs text-gray-500">{factorsSummary}</div>
      )}
      {open && factors && factors.length > 0 && (
        <div className="mt-2 rounded border bg-white p-2 text-xs space-y-1">
          {[...factors]
            .sort((a, b) => Math.abs(b.normalized_score * b.weight) - Math.abs(a.normalized_score * a.weight))
            .map((f, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-gray-600 truncate flex-1">{f.label || f.name}</span>
                <span className="text-gray-400 tabular-nums">w {f.weight.toFixed(2)}</span>
                <span className="text-gray-700 tabular-nums">
                  {(f.normalized_score * 100).toFixed(0)}%
                </span>
              </div>
            ))}
        </div>
      )}
    </div>
  )
}
