// app/dashboard/settings/lead-handoff/page.tsx
//
// W51 D4 — practice-configured outbound webhook for reception leads.

'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface Config { id: string; webhook_url: string; event_types: string[]; enabled: boolean; updated_at: string }
interface Delivery {
  id: string; event_type: string; url: string; attempt: number
  http_status: number | null; delivered_at: string | null
  failed_reason: string | null; next_attempt_at: string | null
  created_at: string
}

const EVENT_OPTIONS = [
  { id: 'lead.created',  label: 'Lead created' },
  { id: 'lead.updated',  label: 'Lead updated' },
  { id: 'lead.exported', label: 'Lead exported (marked imported to EHR)' },
]

export default function LeadHandoffPage() {
  const [config, setConfig] = useState<Config | null>(null)
  const [recent, setRecent] = useState<Delivery[]>([])
  const [url, setUrl] = useState('')
  const [secret, setSecret] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [events, setEvents] = useState<string[]>(['lead.created', 'lead.updated'])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pinging, setPinging] = useState(false)

  async function load() {
    const r = await fetch('/api/reception/lead-webhook')
    const j = await r.json()
    if (r.ok) {
      setConfig(j.config)
      setRecent(j.recent ?? [])
      if (j.config) {
        setUrl(j.config.webhook_url)
        setEnabled(j.config.enabled)
        setEvents(j.config.event_types ?? events)
      }
    }
  }
  useEffect(() => { void load() }, [])

  async function save() {
    if (!url || (!secret && !config)) {
      setError(!url ? 'URL required' : 'Secret required for first setup')
      return
    }
    setSaving(true); setError(null)
    try {
      const body: any = { webhook_url: url, event_types: events, enabled }
      if (secret) body.webhook_secret = secret
      else body.webhook_secret = 'harbor-keep-existing' // server still requires non-empty; UX will prompt for secret on every save
      const r = await fetch('/api/reception/lead-webhook', {
        method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      })
      const j = await r.json()
      if (!r.ok) setError(j.error || 'Save failed')
      else { setSecret(''); void load() }
    } finally { setSaving(false) }
  }

  async function ping() {
    setPinging(true)
    try {
      await fetch('/api/reception/lead-webhook/test', { method: 'POST' })
      setTimeout(load, 1500)
    } finally { setPinging(false) }
  }

  async function remove() {
    if (!confirm('Remove webhook configuration? Future leads will not be delivered.')) return
    await fetch('/api/reception/lead-webhook', { method: 'DELETE' })
    setConfig(null); setUrl(''); setSecret(''); void load()
  }

  return (
    <div className="max-w-3xl mx-auto p-6">
      <Link href="/dashboard/settings" className="text-sm text-gray-500 hover:text-gray-700">← Back to settings</Link>
      <h1 className="text-2xl font-semibold text-gray-900 mt-2">Lead handoff webhook</h1>
      <p className="text-sm text-gray-500 mt-1">
        Forward reception leads to your EHR or CRM. Each request includes an <code>x-harbor-signature</code> header (HMAC-SHA256 over the JSON body using your secret).
      </p>

      <div className="bg-white border border-gray-200 rounded-xl p-5 mt-5 space-y-3">
        <label className="block">
          <span className="text-xs uppercase tracking-wide text-gray-500">Webhook URL</span>
          <input type="url" value={url} onChange={e => setUrl(e.target.value)}
            placeholder="https://example.com/leads"
            className="mt-1 w-full border border-gray-300 rounded px-3 py-2 text-sm" />
        </label>
        <label className="block">
          <span className="text-xs uppercase tracking-wide text-gray-500">
            Shared secret {config && <span className="text-gray-400 normal-case">(leave blank to keep existing)</span>}
          </span>
          <input type="password" value={secret} onChange={e => setSecret(e.target.value)}
            placeholder="32+ chars random"
            className="mt-1 w-full border border-gray-300 rounded px-3 py-2 text-sm font-mono" />
        </label>
        <div>
          <span className="text-xs uppercase tracking-wide text-gray-500">Events</span>
          <div className="mt-1 space-y-1">
            {EVENT_OPTIONS.map(o => (
              <label key={o.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox"
                  checked={events.includes(o.id)}
                  onChange={e => setEvents(e.target.checked ? [...events, o.id] : events.filter(x => x !== o.id))} />
                {o.label}
              </label>
            ))}
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} /> Enabled
        </label>
        {error && <div className="text-sm text-red-600">{error}</div>}
        <div className="flex items-center gap-2">
          <button onClick={save} disabled={saving}
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-md disabled:opacity-50">
            {saving ? 'Saving…' : 'Save'}
          </button>
          {config && (
            <>
              <button onClick={ping} disabled={pinging}
                className="border border-gray-300 hover:bg-gray-50 text-sm rounded-md px-3 py-2">
                {pinging ? 'Sending…' : 'Send test'}
              </button>
              <button onClick={remove} className="text-sm text-red-600 hover:text-red-800 ml-2">Remove</button>
            </>
          )}
        </div>
      </div>

      <h2 className="text-sm font-semibold text-gray-900 mt-6 mb-2">Recent deliveries</h2>
      {recent.length === 0 ? (
        <div className="bg-white border border-dashed border-gray-300 rounded-xl p-6 text-center text-sm text-gray-500">
          No deliveries yet.
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl divide-y">
          {recent.map(d => (
            <div key={d.id} className="px-4 py-3 flex items-center justify-between text-sm">
              <div className="min-w-0">
                <div className="font-medium text-gray-900">{d.event_type}</div>
                <div className="text-xs text-gray-500">
                  {d.delivered_at ? `Delivered ${new Date(d.delivered_at).toLocaleString()}` :
                    d.failed_reason ? `Failed: ${d.failed_reason}` : 'Pending'}
                  {d.attempt > 1 && ` · attempt ${d.attempt}`}
                </div>
              </div>
              <div className="text-xs">
                <span className={d.http_status && d.http_status < 400 ? 'text-emerald-700' : 'text-red-700'}>
                  {d.http_status ?? '—'}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
