'use client'

// Wave 42 / T2 — AI receptionist + locations + test-call settings.
//
// Sits as a sub-page off /dashboard/settings rather than mutating
// the existing 880-line settings/page.tsx (collision risk with
// active edits). The main settings page will get a "AI Receptionist"
// link in the practice tab as a small follow-up.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Save, Phone, Plus, Trash2, X, AlertCircle, MapPin, Bot } from 'lucide-react'

interface Location {
  id: string
  name: string
  address_line1: string | null
  address_line2: string | null
  city: string | null
  state: string | null
  zip: string | null
  phone: string | null
  modality_preference: 'in_person' | 'telehealth' | 'both'
  is_primary: boolean
  is_active: boolean
}

const DEFAULT_PROMPT_PLACEHOLDER = `You are Ellie, the AI receptionist at {{practice_name}}. You're warm, professional, and unflappable. You can:

- Answer questions about hours, services, insurance accepted
- Book new patient intakes
- Schedule existing patients with their therapist
- Take messages for the therapist
- Handle crisis calls with care (warm handoff to {{therapist_name}})

Tone: kind, calm, patient. Never mention you're an AI unless asked directly. Never give clinical advice.`

export default function AIReceptionistSettings() {
  const [prompt, setPrompt] = useState('')
  const [hasLlm, setHasLlm] = useState(false)
  const [aiName, setAiName] = useState('Ellie')
  const [locations, setLocations] = useState<Location[]>([])
  const [loading, setLoading] = useState(true)
  const [savingPrompt, setSavingPrompt] = useState(false)
  const [savedPromptAt, setSavedPromptAt] = useState<string | null>(null)
  const [retellPushOk, setRetellPushOk] = useState<boolean | null>(null)
  const [retellPushError, setRetellPushError] = useState<string | null>(null)
  const [testCallTo, setTestCallTo] = useState('')
  const [testCallStatus, setTestCallStatus] = useState<string | null>(null)
  const [testCalling, setTestCalling] = useState(false)
  const [showLocForm, setShowLocForm] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      const [pr, lr] = await Promise.all([
        fetch('/api/ehr/practice/ai-prompt', { credentials: 'include' }).then((r) => r.ok ? r.json() : null),
        fetch('/api/ehr/practice/locations', { credentials: 'include' }).then((r) => r.ok ? r.json() : null),
      ])
      setPrompt(pr?.prompt_override ?? '')
      setHasLlm(!!pr?.has_retell_llm)
      setAiName(pr?.ai_name ?? 'Ellie')
      setLocations(lr?.locations ?? [])
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { void load() }, [])

  async function savePrompt() {
    setSavingPrompt(true); setError(null); setRetellPushOk(null); setRetellPushError(null)
    try {
      const res = await fetch('/api/ehr/practice/ai-prompt', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt_override: prompt || null }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setError(data?.error?.message || `Save failed (${res.status})`)
        return
      }
      setSavedPromptAt(new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }))
      setRetellPushOk(!!data?.retell_pushed)
      setRetellPushError(data?.retell_error ?? null)
    } finally {
      setSavingPrompt(false)
    }
  }

  async function triggerTestCall() {
    setTestCalling(true); setTestCallStatus(null)
    try {
      const res = await fetch('/api/ehr/practice/test-call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to_number: testCallTo }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setTestCallStatus(`Failed: ${data?.error?.message || `HTTP ${res.status}`}`)
        return
      }
      setTestCallStatus(`Calling… (${data.callId ? `Retell call ${data.callId.slice(0, 8)}` : 'queued'})`)
    } finally {
      setTestCalling(false)
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
    <main className="flex-1 max-w-3xl mx-auto w-full p-6 pb-32">
      <Link href="/dashboard/settings"
            className="inline-flex items-center gap-1 text-sm text-teal-700 hover:text-teal-800"
            style={{ minHeight: 44 }}>
        <ArrowLeft className="w-4 h-4" /> Back to settings
      </Link>

      <h1 className="text-2xl font-bold text-gray-900 mt-3 flex items-center gap-2">
        <Bot className="w-6 h-6 text-teal-700" />
        AI receptionist
      </h1>
      <p className="text-sm text-gray-500 mt-1">
        Customize {aiName}'s prompt, manage your office locations, and run a live test call.
      </p>

      {error && (
        <div className="mt-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />{error}
        </div>
      )}

      {/* Prompt editor */}
      <div className="mt-5 bg-white rounded-xl border border-gray-200 p-4">
        <h2 className="text-base font-semibold text-gray-900 mb-1">{aiName}'s prompt</h2>
        <p className="text-xs text-gray-500 mb-3">
          Override the default prompt for your practice. Leave empty to keep the
          Harbor baseline. {`{{practice_name}}`} and {`{{therapist_name}}`} are
          substituted per-call by Retell.
        </p>
        <textarea
          rows={14}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={DEFAULT_PROMPT_PLACEHOLDER}
          className="w-full p-3 text-sm font-mono border border-gray-200 rounded-lg focus:ring-2 focus:ring-teal-500"
        />
        <div className="flex items-center justify-between mt-3 gap-3 flex-wrap">
          <div className="text-xs text-gray-500">
            {savedPromptAt && <span className="text-green-700">Saved at {savedPromptAt}. </span>}
            {retellPushOk === true && <span className="text-green-700">Pushed to Retell.</span>}
            {retellPushOk === false && retellPushError && (
              <span className="text-amber-700">Saved, but Retell push failed: {retellPushError}</span>
            )}
            {!hasLlm && <span className="text-amber-700">No Retell LLM provisioned for this practice yet.</span>}
          </div>
          <button onClick={savePrompt} disabled={savingPrompt}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 disabled:opacity-60"
                  style={{ minHeight: 44 }}>
            <Save className="w-4 h-4" /> {savingPrompt ? 'Saving…' : 'Save prompt'}
          </button>
        </div>
      </div>

      {/* Test call */}
      <div className="mt-5 bg-white rounded-xl border border-gray-200 p-4">
        <h2 className="text-base font-semibold text-gray-900 mb-1">Test call</h2>
        <p className="text-xs text-gray-500 mb-3">
          {aiName} will call your number using the current prompt. Useful for a
          quick listen-test after editing.
        </p>
        <div className="flex items-end gap-2 flex-wrap">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-medium text-gray-700 mb-1">Your number (E.164)</label>
            <input value={testCallTo} onChange={(e) => setTestCallTo(e.target.value)}
                   placeholder="+15555550123"
                   className="w-full p-2 text-sm border border-gray-200 rounded-lg" style={{ minHeight: 44 }} />
          </div>
          <button onClick={triggerTestCall} disabled={testCalling || !testCallTo}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 disabled:opacity-60"
                  style={{ minHeight: 44 }}>
            <Phone className="w-4 h-4" /> {testCalling ? 'Calling…' : 'Test call'}
          </button>
        </div>
        {testCallStatus && (
          <div className="mt-3 text-xs text-gray-700">{testCallStatus}</div>
        )}
      </div>

      {/* Locations */}
      <div className="mt-5 bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-gray-900 flex items-center gap-1">
            <MapPin className="w-4 h-4 text-teal-700" />
            Locations
          </h2>
          <button onClick={() => setShowLocForm(true)}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-teal-600 rounded-md hover:bg-teal-700"
                  style={{ minHeight: 36 }}>
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        </div>
        {locations.length === 0 ? (
          <p className="text-sm text-gray-500">No additional locations. Your practice's primary address (set in your account settings) is used as the default.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {locations.map((l) => (
              <li key={l.id} className="py-3 flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <div className="text-sm font-semibold text-gray-900">
                    {l.name}
                    {l.is_primary && <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-teal-100 text-teal-800">Primary</span>}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {[l.address_line1, l.city, l.state, l.zip].filter(Boolean).join(', ')}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    Modality: <strong>{l.modality_preference}</strong>
                    {l.phone && <> · {l.phone}</>}
                  </div>
                </div>
                <button
                  onClick={async () => {
                    if (!confirm('Deactivate this location?')) return
                    const res = await fetch(`/api/ehr/practice/locations/${l.id}`, { method: 'DELETE', credentials: 'include' })
                    if (res.ok) await load()
                  }}
                  className="text-red-700 hover:bg-red-50 p-2 rounded-md"
                  style={{ minHeight: 44, minWidth: 44 }}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {showLocForm && <LocationForm onClose={() => setShowLocForm(false)} onSaved={load} />}
    </main>
  )
}

function LocationForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => Promise<void> }) {
  const [name, setName] = useState('')
  const [addr1, setAddr1] = useState('')
  const [city, setCity] = useState('')
  const [state, setState] = useState('')
  const [zip, setZip] = useState('')
  const [phone, setPhone] = useState('')
  const [modality, setModality] = useState<'in_person'|'telehealth'|'both'>('both')
  const [isPrimary, setIsPrimary] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setSubmitting(true); setError(null)
    try {
      const res = await fetch('/api/ehr/practice/locations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name, address_line1: addr1, city, state, zip, phone,
          modality_preference: modality, is_primary: isPrimary,
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) { setError(data?.error?.message || `Create failed (${res.status})`); return }
      await onSaved(); onClose()
    } finally { setSubmitting(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-gray-900">New location</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" style={{ minHeight: 44, minWidth: 44 }}>
            <X className="w-5 h-5" />
          </button>
        </div>
        {error && <div className="mb-3 p-2 rounded bg-red-50 border border-red-200 text-xs text-red-800">{error}</div>}
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Location name</label>
            <input value={name} onChange={(e) => setName(e.target.value)}
                   placeholder="e.g. Klamath Falls Office" className="w-full p-2 text-sm border border-gray-200 rounded-lg" style={{ minHeight: 44 }} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Address</label>
            <input value={addr1} onChange={(e) => setAddr1(e.target.value)}
                   className="w-full p-2 text-sm border border-gray-200 rounded-lg" style={{ minHeight: 44 }} />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">City</label>
              <input value={city} onChange={(e) => setCity(e.target.value)} className="w-full p-2 text-sm border border-gray-200 rounded-lg" style={{ minHeight: 44 }} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">State</label>
              <input value={state} onChange={(e) => setState(e.target.value)} className="w-full p-2 text-sm border border-gray-200 rounded-lg" style={{ minHeight: 44 }} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">ZIP</label>
              <input value={zip} onChange={(e) => setZip(e.target.value)} className="w-full p-2 text-sm border border-gray-200 rounded-lg" style={{ minHeight: 44 }} />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Phone</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full p-2 text-sm border border-gray-200 rounded-lg" style={{ minHeight: 44 }} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Modality</label>
            <select value={modality} onChange={(e) => setModality(e.target.value as any)}
                    className="w-full p-2 text-sm border border-gray-200 rounded-lg" style={{ minHeight: 44 }}>
              <option value="both">Both telehealth + in-person</option>
              <option value="in_person">In-person only</option>
              <option value="telehealth">Telehealth only</option>
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ minHeight: 44 }}>
            <input type="checkbox" checked={isPrimary} onChange={(e) => setIsPrimary(e.target.checked)} />
            <span>Make this the primary location</span>
          </label>
        </div>
        <div className="flex items-center justify-end gap-2 mt-4">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg" style={{ minHeight: 44 }}>Cancel</button>
          <button onClick={submit} disabled={submitting || !name}
                  className="px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 disabled:opacity-60"
                  style={{ minHeight: 44 }}>
            {submitting ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
