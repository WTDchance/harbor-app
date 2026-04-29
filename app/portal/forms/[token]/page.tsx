// app/portal/forms/[token]/page.tsx
//
// W49 D1 — patient-facing form page. Token-gated; no portal login required.

'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

interface Field {
  id: string
  type: 'short_text' | 'long_text' | 'multiselect' | 'select' | 'rating' | 'date' | 'signature' | 'phone' | 'email' | 'number'
  label: string
  required: boolean
  options?: string[]
  validation?: { min?: number; max?: number; regex?: string }
  helpText?: string
}

export default function PortalFormPage() {
  const params = useParams<{ token: string }>()
  const token = params.token
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [meta, setMeta] = useState<{ form: any; practice: any; patient: any; assignment: any } | null>(null)
  const [values, setValues] = useState<Record<string, any>>({})
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/portal/custom-forms/${token}`)
        const j = await res.json()
        if (!res.ok) {
          setError(j.error === 'expired' ? 'This form has expired. Please contact your provider.'
                 : j.error === 'cancelled' ? 'This form was cancelled.'
                 : j.error === 'not_found' ? 'Form not found.'
                 : 'Could not load form.')
        } else if (!cancelled) {
          setMeta(j)
          if (j.assignment?.status === 'submitted') setDone(true)
        }
      } finally { if (!cancelled) setLoading(false) }
    })()
    return () => { cancelled = true }
  }, [token])

  async function submit() {
    if (!meta) return
    setSubmitting(true); setError(null)
    try {
      const res = await fetch(`/api/portal/custom-forms/${token}/submit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ response: values }),
      })
      const j = await res.json()
      if (!res.ok) setError(j.message || j.error || 'Submission failed')
      else setDone(true)
    } finally { setSubmitting(false) }
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center text-sm text-gray-500">Loading form…</div>

  if (error || !meta) return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="max-w-md text-center bg-white border border-red-200 rounded-xl p-8">
        <h1 className="text-lg font-semibold text-red-700">Unable to load form</h1>
        <p className="text-sm text-gray-600 mt-2">{error}</p>
      </div>
    </div>
  )

  if (done) return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="max-w-md text-center bg-white border border-green-200 rounded-xl p-8">
        <h1 className="text-lg font-semibold text-green-700">Submitted — thank you</h1>
        <p className="text-sm text-gray-600 mt-2">Your responses were sent to {meta.practice?.name ?? 'your provider'}.</p>
      </div>
    </div>
  )

  const schema: Field[] = meta.assignment.schema ?? []

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-2xl mx-auto bg-white rounded-xl border border-gray-200 p-6 sm:p-8">
        <div className="text-xs uppercase tracking-wide text-gray-500">{meta.practice?.name}</div>
        <h1 className="text-2xl font-semibold text-gray-900 mt-1">{meta.form?.name}</h1>
        {meta.form?.description && <p className="text-sm text-gray-600 mt-2">{meta.form.description}</p>}
        <p className="text-sm text-gray-500 mt-2">For: {meta.patient?.first_name} {meta.patient?.last_name}</p>

        <div className="mt-6 space-y-5">
          {schema.map((f, idx) => (
            <FieldRenderer
              key={f.id}
              field={f}
              index={idx}
              value={values[f.id]}
              onChange={(v) => setValues((s) => ({ ...s, [f.id]: v }))}
            />
          ))}
        </div>

        <div className="mt-6 flex justify-end">
          <button
            onClick={submit} disabled={submitting}
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-md disabled:opacity-50"
          >
            {submitting ? 'Submitting…' : 'Submit'}
          </button>
        </div>
      </div>
    </div>
  )
}

function FieldRenderer({ field, index, value, onChange }: {
  field: Field; index: number; value: any; onChange: (v: any) => void
}) {
  const labelEl = (
    <label className="block text-sm font-medium text-gray-900">
      <span className="text-gray-400 mr-1">{index + 1}.</span>{field.label}
      {field.required && <span className="text-red-600 ml-0.5">*</span>}
    </label>
  )
  const help = field.helpText ? <p className="text-xs text-gray-500 mt-1">{field.helpText}</p> : null

  if (field.type === 'short_text' || field.type === 'phone' || field.type === 'email') {
    return (
      <div>{labelEl}{help}
        <input type={field.type === 'email' ? 'email' : field.type === 'phone' ? 'tel' : 'text'}
          value={value ?? ''} onChange={(e) => onChange(e.target.value)}
          className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 text-sm" />
      </div>
    )
  }
  if (field.type === 'long_text') {
    return (
      <div>{labelEl}{help}
        <textarea value={value ?? ''} onChange={(e) => onChange(e.target.value)} rows={4}
          className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 text-sm" />
      </div>
    )
  }
  if (field.type === 'number') {
    return (
      <div>{labelEl}{help}
        <input type="number" value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
          className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 text-sm" />
      </div>
    )
  }
  if (field.type === 'date') {
    return (
      <div>{labelEl}{help}
        <input type="date" value={value ?? ''} onChange={(e) => onChange(e.target.value)}
          className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 text-sm" />
      </div>
    )
  }
  if (field.type === 'select') {
    return (
      <div>{labelEl}{help}
        <select value={value ?? ''} onChange={(e) => onChange(e.target.value)}
          className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 text-sm">
          <option value="">— Select —</option>
          {(field.options ?? []).map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>
    )
  }
  if (field.type === 'multiselect') {
    const arr: string[] = Array.isArray(value) ? value : []
    return (
      <div>{labelEl}{help}
        <div className="mt-2 space-y-1">
          {(field.options ?? []).map(o => (
            <label key={o} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={arr.includes(o)}
                onChange={(e) => onChange(e.target.checked ? [...arr, o] : arr.filter(x => x !== o))} />
              {o}
            </label>
          ))}
        </div>
      </div>
    )
  }
  if (field.type === 'rating') {
    const min = field.validation?.min ?? 1, max = field.validation?.max ?? 5
    const ns: number[] = []
    for (let i = min; i <= max; i++) ns.push(i)
    return (
      <div>{labelEl}{help}
        <div className="mt-2 flex gap-2">
          {ns.map(n => (
            <button type="button" key={n} onClick={() => onChange(n)}
              className={`w-9 h-9 rounded-full border text-sm ${value === n ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 hover:bg-gray-100'}`}>
              {n}
            </button>
          ))}
        </div>
      </div>
    )
  }
  if (field.type === 'signature') {
    return (
      <div>{labelEl}{help}
        <input type="text" placeholder="Type your full name to sign"
          value={value ?? ''} onChange={(e) => onChange(e.target.value)}
          className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 text-sm font-serif italic" />
      </div>
    )
  }
  return null
}
