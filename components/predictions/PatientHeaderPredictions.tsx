// components/predictions/PatientHeaderPredictions.tsx
//
// W45 T6 — small inline strip rendered on the patient detail header.
// Shows engagement + next-appointment no-show, expandable factors,
// override.

'use client'

import { useEffect, useState } from 'react'
import { PredictionBadge, type PredictionFactor } from './PredictionBadge'

type Prediction = {
  id: string
  prediction_kind: string
  score: number
  factors: { contributions?: PredictionFactor[]; summary?: string; formula_version?: string }
  override_score: number | null
  override_reason: string | null
  override_at: string | null
}

type ApiResponse = {
  patient_level: Prediction[]
  upcoming_no_show: (Prediction & { appointment_id: string; scheduled_for: string }) | null
}

export default function PatientHeaderPredictions({ patientId }: { patientId: string }) {
  const [data, setData] = useState<ApiResponse | null>(null)

  async function load() {
    try {
      const res = await fetch(`/api/ehr/predictions/by-patient/${patientId}`)
      if (!res.ok) return
      setData(await res.json())
    } catch {}
  }

  useEffect(() => { void load() }, [patientId])

  if (!data) return null

  const engagement = data.patient_level.find((p) => p.prediction_kind === 'engagement_score')
  const noShow = data.upcoming_no_show

  if (!engagement && !noShow) return null

  return (
    <div className="flex flex-wrap items-start gap-3 mt-2">
      {noShow && noShow.score > 0 && (
        <BadgeWithOverride
          prediction={noShow}
          onChanged={load}
          label="no-show next visit"
          patientId={patientId}
        />
      )}
      {engagement && (
        <BadgeWithOverride
          prediction={engagement}
          onChanged={load}
          label="engagement"
          patientId={patientId}
        />
      )}
    </div>
  )
}

function BadgeWithOverride({
  prediction,
  onChanged,
  label,
  patientId: _patientId,
}: {
  prediction: Prediction
  onChanged: () => void
  label: string
  patientId: string
}) {
  const [showOverride, setShowOverride] = useState(false)
  const [overrideValue, setOverrideValue] = useState(
    prediction.override_score != null ? String(prediction.override_score) : '',
  )
  const [reason, setReason] = useState(prediction.override_reason || '')
  const [saving, setSaving] = useState(false)

  const effectiveScore =
    prediction.override_score != null ? prediction.override_score : prediction.score

  async function save(clear: boolean) {
    setSaving(true)
    try {
      const body = clear
        ? { override_score: null }
        : { override_score: Number(overrideValue), reason: reason || undefined }
      await fetch(`/api/ehr/predictions/${prediction.id}/override`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      setShowOverride(false)
      onChanged()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-1">
      <PredictionBadge
        kind={prediction.prediction_kind}
        score={effectiveScore}
        label={label + (prediction.override_score != null ? ' (overridden)' : '')}
        factorsSummary={prediction.factors?.summary}
        factors={prediction.factors?.contributions}
      />
      <button
        onClick={() => setShowOverride(!showOverride)}
        className="text-[10px] text-gray-500 hover:underline"
      >
        {showOverride ? 'Cancel' : 'Override'}
      </button>
      {showOverride && (
        <div className="mt-1 rounded border bg-white p-2 text-xs space-y-1">
          <label className="block">
            New score (0–1)
            <input
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={overrideValue}
              onChange={(e) => setOverrideValue(e.target.value)}
              className="block w-full border rounded px-2 py-1 mt-0.5"
            />
          </label>
          <label className="block">
            Reason
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why does the model have this wrong?"
              className="block w-full border rounded px-2 py-1 mt-0.5"
            />
          </label>
          <div className="flex gap-2">
            <button
              onClick={() => save(false)}
              disabled={saving || overrideValue === ''}
              className="bg-[#1f375d] text-white px-2 py-1 rounded text-xs disabled:opacity-50"
            >
              Save
            </button>
            {prediction.override_score != null && (
              <button
                onClick={() => save(true)}
                disabled={saving}
                className="text-red-600 hover:underline"
              >
                Clear override
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
