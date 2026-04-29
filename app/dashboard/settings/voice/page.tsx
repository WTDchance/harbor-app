// app/dashboard/settings/voice/page.tsx
//
// W51 D7 — greeting + voice customization.

'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface VoiceOption { id: string; name: string }

const PROMPT_PLACEHOLDER = `# Your AI Receptionist

You are Ellie, the AI receptionist for {{ practice_name }}.

1. Greet warmly. "Hi, this is Ellie at {{ practice_name }} — how can I help?"
2. If new patient: capture full name, DOB, phone, email.
3. Confirm reason for the call in their words.
4. Ask if they have insurance; capture carrier + member ID.
5. Ask about urgency: routine, soon, today, crisis.
6. If they want to schedule: offer the next 3 open slots.
7. If they ask about cost: be honest. Self-pay rate is $X. Insurance varies.
8. If crisis language is detected: 988 / 911 referral, alert the therapist.
9. Take a message if no immediate slot fits.
10. Confirm what you captured before ending.
11. Thank them warmly.
`

export default function VoiceSettingsPage() {
  const [prompt, setPrompt] = useState('')
  const [voiceId, setVoiceId] = useState('')
  const [voiceOptions, setVoiceOptions] = useState<VoiceOption[]>([])
  const [aiName, setAiName] = useState<string>('Ellie')
  const [hasLlm, setHasLlm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    const r = await fetch('/api/reception/voice')
    const j = await r.json()
    if (r.ok) {
      setPrompt(j.prompt_override ?? '')
      setVoiceId(j.voice_id ?? '')
      setVoiceOptions(j.voice_options ?? [])
      setAiName(j.ai_name ?? 'Ellie')
      setHasLlm(j.has_retell_llm)
    } else {
      setError(j.error || 'Failed to load')
    }
  }
  useEffect(() => { void load() }, [])

  async function save() {
    setSaving(true); setError(null)
    try {
      const r = await fetch('/api/reception/voice', {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          prompt_override: prompt.trim() || null,
          voice_id: voiceId || null,
        }),
      })
      const j = await r.json()
      if (!r.ok) setError(j.error || 'Save failed')
      else setSavedAt(new Date())
    } finally { setSaving(false) }
  }

  return (
    <div className="max-w-3xl mx-auto p-6">
      <Link href="/dashboard/settings" className="text-sm text-gray-500 hover:text-gray-700">← Back to settings</Link>
      <h1 className="text-2xl font-semibold text-gray-900 mt-2">Greeting & voice</h1>
      <p className="text-sm text-gray-500 mt-1">Customize what {aiName} says when calls come in. Pick a voice. Save and re-deploy.</p>

      {error && <div className="mt-4 text-sm text-red-600">{error}</div>}
      {!hasLlm && (
        <div className="mt-4 bg-amber-50 border border-amber-300 rounded-md p-3 text-xs text-amber-800">
          The AI receptionist agent isn't provisioned yet. Save anyway — we'll apply your customizations on first deploy.
        </div>
      )}

      <div className="mt-6 space-y-4">
        <label className="block">
          <span className="text-xs uppercase tracking-wide text-gray-500">Voice</span>
          <select value={voiceId} onChange={e => setVoiceId(e.target.value)}
            className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-sm">
            <option value="">Application default</option>
            {voiceOptions.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <p className="text-[11px] text-gray-400 mt-1">Audio previews coming soon. For now, pick by description and listen on a test call.</p>
        </label>

        <label className="block">
          <span className="text-xs uppercase tracking-wide text-gray-500">Greeting / system prompt</span>
          <textarea value={prompt} onChange={e => setPrompt(e.target.value)}
            rows={18}
            placeholder={PROMPT_PLACEHOLDER}
            className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-sm font-mono" />
          <p className="text-[11px] text-gray-400 mt-1">Leave blank to use Harbor's 11-step default. Edits are pushed to your Retell agent on save.</p>
        </label>

        <div className="flex items-center gap-3">
          <button onClick={save} disabled={saving}
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-md disabled:opacity-50">
            {saving ? 'Saving…' : 'Save & re-deploy to Retell'}
          </button>
          {savedAt && <span className="text-xs text-gray-400">Saved {savedAt.toLocaleTimeString()}</span>}
        </div>
      </div>
    </div>
  )
}
