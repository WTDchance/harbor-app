'use client'

// Wave 39 / Task 2 — discharge summary editor page.
//
// Single form. Auto-fetches existing summary; if none, the "Discharge
// patient" button creates a draft. Locked once completed.

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, FileText, Save, Check } from 'lucide-react'

const DISCHARGE_REASONS: Array<{ value: string; label: string }> = [
  { value: 'completed',           label: 'Treatment goals met' },
  { value: 'mutual_termination',  label: 'Mutual termination' },
  { value: 'therapist_initiated', label: 'Therapist-initiated' },
  { value: 'patient_initiated',   label: 'Patient-initiated' },
  { value: 'transferred',         label: 'Transferred' },
  { value: 'no_show_extended',    label: 'Extended no-show / drop-out' },
  { value: 'other',               label: 'Other' },
]

const TEXT_FIELDS: Array<{ key: string; label: string; helper?: string; required?: boolean; rows?: number }> = [
  { key: 'services_dates',               label: 'Services dates',               helper: 'e.g. April 2025 – April 2026',         required: true,  rows: 2 },
  { key: 'presenting_problem',           label: 'Presenting problem',           required: true,  rows: 3 },
  { key: 'course_of_treatment',          label: 'Course of treatment',          helper: 'Interventions used, frequency.',       required: true,  rows: 4 },
  { key: 'progress_summary',             label: 'Progress summary',             required: true,  rows: 4 },
  { key: 'recommendations',              label: 'Recommendations',              helper: 'Continued therapy, group, none, etc.', required: true,  rows: 3 },
  { key: 'medications_at_discharge',     label: 'Medications at discharge',     rows: 2 },
  { key: 'risk_assessment_at_discharge', label: 'Risk assessment at discharge', helper: 'Suicidality/violence risk and current status.', rows: 3 },
  { key: 'referrals',                    label: 'Referrals',                    helper: 'Where transferred to, if applicable.', rows: 2 },
]

interface Summary {
  id: string
  patient_id: string
  status: 'draft' | 'completed'
  discharge_reason: string
  discharged_at: string
  completed_at: string | null
  final_diagnoses: string[] | null
  [key: string]: unknown
}

export default function DischargePage() {
  const params = useParams()
  const router = useRouter()
  const patientId = String(params.id)

  const [summary, setSummary] = useState<Summary | null>(null)
  const [fields, setFields] = useState<Record<string, string>>({})
  const [reason, setReason] = useState<string>('completed')
  const [diagnoses, setDiagnoses] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [completing, setCompleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch(`/api/ehr/patients/${patientId}/discharge-summary`, { credentials: 'include' })
      if (!res.ok) {
        setSummary(null)
      } else {
        const { summary: s } = await res.json()
        setSummary(s)
        if (s) {
          const next: Record<string, string> = {}
          for (const f of TEXT_FIELDS) next[f.key] = (s[f.key] as string) ?? ''
          setFields(next)
          setReason(s.discharge_reason || 'completed')
          setDiagnoses((s.final_diagnoses as string[] | null)?.join(', ') ?? '')
        }
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [patientId])

  const isLocked = summary?.status === 'completed'

  async function ensureDraft() {
    if (summary) return summary
    const res = await fetch(`/api/ehr/patients/${patientId}/discharge-summary`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ discharge_reason: reason }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => null)
      throw new Error(data?.error?.message || `Create failed (${res.status})`)
    }
    const { summary: s } = await res.json()
    setSummary(s)
    return s
  }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      await ensureDraft()
      const body: Record<string, unknown> = { ...fields, discharge_reason: reason }
      const dxs = diagnoses.split(',').map((s) => s.trim()).filter(Boolean)
      if (dxs.length > 0) body.final_diagnoses = dxs
      const res = await fetch(`/api/ehr/patients/${patientId}/discharge-summary`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setError(data?.error?.message || `Save failed (${res.status})`)
        return
      }
      const { summary: s } = await res.json()
      setSummary(s)
    } catch (err: any) {
      setError(err?.message || 'Network error')
    } finally {
      setSaving(false)
    }
  }

  async function complete() {
    if (!confirm('Discharge this patient? Their status will change to discharged and the summary will be locked.')) return
    setCompleting(true)
    setError(null)
    try {
      await save()
      const res = await fetch(`/api/ehr/patients/${patientId}/discharge-summary/complete`, {
        method: 'POST',
        credentials: 'include',
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setError(data?.error?.message || `Complete failed (${res.status})`)
        return
      }
      const { summary: s } = await res.json()
      setSummary(s)
    } catch (err: any) {
      setError(err?.message || 'Network error')
    } finally {
      setCompleting(false)
    }
  }

  if (loading) {
    return (
      <main className="flex-1 flex items-center justify-center min-h-[60vh]">
        <div className="w-6 h-6 border-2 border-teal-600 border-t-transparent rounded-full animate-spin" />
      </main>
    )
  }

  return (
    <main className="flex-1 max-w-3xl mx-auto w-full pb-32">
      <div className="px-4 pt-4">
        <Link
          href={`/dashboard/patients/${patientId}`}
          className="inline-flex items-center gap-1 text-sm text-teal-700 hover:text-teal-800"
          style={{ minHeight: 44 }}
        >
          <ArrowLeft className="w-4 h-4" />
          Back to patient
        </Link>
        <div className="flex items-center justify-between mt-3">
          <div>
            <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <FileText className="w-5 h-5 text-teal-700" />
              Discharge summary
            </h1>
            <p className="text-xs text-gray-500 mt-0.5">
              {summary
                ? `Started ${new Date((summary as any).created_at).toLocaleDateString()}`
                : 'No discharge summary yet — fields below will create a draft when you save.'}
            </p>
          </div>
          {summary && (
            <span
              className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${
                isLocked ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'
              }`}
            >
              {isLocked ? 'Completed' : 'Draft'}
            </span>
          )}
        </div>
      </div>

      {error && (
        <div className="mx-4 mt-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">
          {error}
        </div>
      )}

      <div className="mt-4 px-4 space-y-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <label className="block text-sm font-semibold text-gray-900">Discharge reason</label>
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={isLocked}
            className="mt-2 w-full p-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:bg-gray-50 disabled:text-gray-700"
            style={{ minHeight: 44 }}
          >
            {DISCHARGE_REASONS.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </div>

        {TEXT_FIELDS.map((f) => (
          <div key={f.key} className="bg-white rounded-xl border border-gray-200 p-4">
            <label className="block text-sm font-semibold text-gray-900">
              {f.label}{f.required && <span className="text-red-600 ml-1">*</span>}
            </label>
            {f.helper && <p className="text-xs text-gray-500 mt-0.5 mb-2">{f.helper}</p>}
            <textarea
              value={fields[f.key] ?? ''}
              onChange={(e) => setFields((prev) => ({ ...prev, [f.key]: e.target.value }))}
              disabled={isLocked}
              rows={f.rows ?? 3}
              className="w-full p-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:bg-gray-50 disabled:text-gray-700"
              style={{ minHeight: 44 + (f.rows ?? 3) * 16 }}
            />
          </div>
        ))}

        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <label className="block text-sm font-semibold text-gray-900">Final diagnoses (ICD-10)</label>
          <p className="text-xs text-gray-500 mt-0.5 mb-2">Comma-separated codes carried forward at discharge.</p>
          <input
            type="text"
            value={diagnoses}
            onChange={(e) => setDiagnoses(e.target.value)}
            disabled={isLocked}
            placeholder="F41.1, F33.1"
            className="w-full p-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:bg-gray-50 disabled:text-gray-700"
            style={{ minHeight: 44 }}
          />
        </div>
      </div>

      {!isLocked && (
        <div
          className="fixed bottom-0 inset-x-0 bg-white border-t border-gray-200 p-3 z-30"
          style={{ paddingBottom: 'env(safe-area-inset-bottom, 12px)' }}
        >
          <div className="max-w-3xl mx-auto flex items-center justify-between gap-2 px-1">
            <div className="text-xs text-gray-500">
              {summary?.status === 'draft' ? 'Draft' : 'Not started'}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={save}
                disabled={saving || completing}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-60"
                style={{ minHeight: 44 }}
              >
                <Save className="w-4 h-4" />
                {saving ? 'Saving…' : 'Save draft'}
              </button>
              <button
                onClick={complete}
                disabled={saving || completing}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 disabled:opacity-60"
                style={{ minHeight: 44 }}
              >
                <Check className="w-4 h-4" />
                {completing ? 'Discharging…' : 'Discharge patient'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
