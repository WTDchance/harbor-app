// app/dashboard/settings/calendar/page.tsx
//
// W51 D3 — practice calendar integration dashboard.

'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface Integration {
  id: string
  therapist_id: string | null
  provider: 'google' | 'outlook'
  account_email: string
  status: 'active' | 'revoked' | 'reauth_required'
  scopes: string[]
  last_sync_at: string | null
  access_token_expires_at: string | null
  created_at: string
}

export default function CalendarSettingsPage() {
  const [list, setList] = useState<Integration[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    try {
      const r = await fetch('/api/reception/calendar/list')
      const j = await r.json()
      if (r.ok) setList(j.integrations ?? [])
      else setError(j.error || 'Could not load')
    } catch { setError('Network error') }
  }
  useEffect(() => { void load() }, [])

  async function disconnect(id: string) {
    if (!confirm('Disconnect this calendar?')) return
    const r = await fetch(`/api/reception/calendar/integration/${id}`, { method: 'DELETE' })
    if (r.ok) void load()
  }

  return (
    <div className="max-w-3xl mx-auto p-6">
      <Link href="/dashboard/settings" className="text-sm text-gray-500 hover:text-gray-700">← Back to settings</Link>
      <h1 className="text-2xl font-semibold text-gray-900 mt-2">Calendar integration</h1>
      <p className="text-sm text-gray-500 mt-1">
        Connect Google or Outlook so the receptionist can read your free/busy and book appointments directly on your calendar.
      </p>

      {error && <div className="mt-4 text-sm text-red-600">{error}</div>}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-5">
        <a href="/api/integrations/google-calendar/auth"
          className="border border-gray-200 rounded-xl p-4 hover:border-blue-400 hover:bg-blue-50/30 transition">
          <div className="text-sm font-semibold text-gray-900">Connect Google Calendar</div>
          <div className="text-xs text-gray-500 mt-1">OAuth via Google Workspace. Read free/busy + create events.</div>
        </a>
        <a href="/api/integrations/outlook/auth"
          className="border border-gray-200 rounded-xl p-4 hover:border-blue-400 hover:bg-blue-50/30 transition">
          <div className="text-sm font-semibold text-gray-900">Connect Outlook / Microsoft 365</div>
          <div className="text-xs text-gray-500 mt-1">OAuth via Microsoft Identity Platform.</div>
        </a>
      </div>

      <h2 className="text-sm font-semibold text-gray-900 mt-6 mb-2">Connected calendars</h2>
      {list === null ? (
        <div className="text-sm text-gray-400">Loading…</div>
      ) : list.length === 0 ? (
        <div className="bg-white border border-dashed border-gray-300 rounded-xl p-8 text-center text-sm text-gray-500">
          None yet — connect Google or Outlook above.
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl divide-y">
          {list.map(it => (
            <div key={it.id} className="px-4 py-3 flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-gray-900">{it.provider === 'google' ? 'Google' : 'Outlook'} · {it.account_email}</div>
                <div className="text-xs text-gray-500">
                  {it.status === 'active' ? 'Active' : it.status === 'revoked' ? 'Revoked' : 'Reauth required'}
                  {it.last_sync_at && ` · last sync ${new Date(it.last_sync_at).toLocaleString()}`}
                </div>
              </div>
              {it.status === 'active' && (
                <button onClick={() => disconnect(it.id)} className="text-xs text-red-600 hover:text-red-800">Disconnect</button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
