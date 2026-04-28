// app/dashboard/ehr/reengagement/page.tsx
//
// W43 T4 — practice-side re-engagement dashboard. Lists campaigns,
// surfaces lapsed candidates per active campaign, lets the user
// select patients and send the configured outreach.

'use client'

import { useEffect, useState } from 'react'

type Campaign = {
  id: string
  name: string
  inactive_days: number
  channel: 'email' | 'sms' | 'patient_choice'
  subject: string | null
  body: string
  active: boolean
}

type Candidate = {
  id: string
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
  communication_preference: string | null
  last_completed: string
  days_since_last: string | number
}

export default function ReengagementPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [selectedCampaign, setSelectedCampaign] = useState<string>('')
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [loadingCampaigns, setLoadingCampaigns] = useState(true)
  const [loadingCandidates, setLoadingCandidates] = useState(false)
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function loadCampaigns() {
    setLoadingCampaigns(true)
    try {
      const res = await fetch('/api/ehr/reengagement/campaigns')
      const j = await res.json()
      setCampaigns(j.campaigns || [])
      const firstActive = (j.campaigns || []).find((c: Campaign) => c.active)
      if (firstActive && !selectedCampaign) setSelectedCampaign(firstActive.id)
    } finally {
      setLoadingCampaigns(false)
    }
  }

  async function loadCandidates(campaignId: string) {
    if (!campaignId) return
    setLoadingCandidates(true)
    setError(null)
    try {
      const res = await fetch(`/api/ehr/reengagement/candidates?campaign_id=${campaignId}`)
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || 'Failed to load candidates')
      }
      const j = await res.json()
      setCandidates(j.candidates || [])
      setPicked(new Set())
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoadingCandidates(false)
    }
  }

  useEffect(() => { void loadCampaigns() }, [])
  useEffect(() => { if (selectedCampaign) void loadCandidates(selectedCampaign) }, [selectedCampaign])

  function togglePick(id: string) {
    const next = new Set(picked)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setPicked(next)
  }
  function pickAll() {
    setPicked(new Set(candidates.map((c) => c.id)))
  }
  function pickNone() { setPicked(new Set()) }

  async function send() {
    if (picked.size === 0) return
    if (!confirm(`Send re-engagement outreach to ${picked.size} patient(s)?`)) return
    setSending(true)
    setResult(null)
    setError(null)
    try {
      const res = await fetch('/api/ehr/reengagement/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaign_id: selectedCampaign,
          patient_ids: Array.from(picked),
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || 'Send failed')
      }
      const j = await res.json()
      setResult(`Sent: ${j.sent_count} · Failed: ${j.failed_count}`)
      await loadCandidates(selectedCampaign)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSending(false)
    }
  }

  const activeCampaign = campaigns.find((c) => c.id === selectedCampaign)

  return (
    <div className="max-w-5xl mx-auto p-4 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Patient re-engagement</h1>
        <p className="text-sm text-gray-600 mt-1">
          Lapsed patients (no completed visit in the configured window
          and no upcoming appointment) appear below. Pick a campaign,
          review the list, and send the configured outreach.
        </p>
      </div>

      {loadingCampaigns ? (
        <p className="text-sm text-gray-500">Loading campaigns…</p>
      ) : campaigns.length === 0 ? (
        <div className="rounded border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          No re-engagement campaigns yet. Create one in Settings → Re-engagement.
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium">Campaign</label>
            <select
              value={selectedCampaign}
              onChange={(e) => setSelectedCampaign(e.target.value)}
              className="border rounded px-2 py-1 text-sm"
            >
              {campaigns.map((c) => (
                <option key={c.id} value={c.id} disabled={!c.active}>
                  {c.name}{c.active ? '' : ' (inactive)'} · {c.inactive_days}d · {c.channel}
                </option>
              ))}
            </select>
          </div>

          {activeCampaign && (
            <details className="rounded border bg-gray-50 p-3 text-sm">
              <summary className="cursor-pointer font-medium">
                Preview message
              </summary>
              <div className="mt-2 whitespace-pre-wrap font-mono text-xs">
                {activeCampaign.subject && <div className="font-bold mb-2">Subject: {activeCampaign.subject}</div>}
                {activeCampaign.body}
              </div>
            </details>
          )}

          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium">
              Candidates {candidates.length > 0 && <span className="text-gray-500 text-sm">({candidates.length})</span>}
            </h2>
            <div className="space-x-2 text-sm">
              <button onClick={pickAll} className="text-gray-600 hover:underline">Select all</button>
              <button onClick={pickNone} className="text-gray-600 hover:underline">Clear</button>
              <button
                onClick={send}
                disabled={sending || picked.size === 0}
                className="bg-[#1f375d] text-white px-3 py-1.5 rounded text-sm disabled:opacity-50"
              >
                {sending ? 'Sending…' : `Send to ${picked.size}`}
              </button>
            </div>
          </div>

          {result && (
            <div className="rounded bg-green-50 border border-green-200 px-3 py-2 text-sm text-green-800">
              {result}
            </div>
          )}
          {error && (
            <div className="rounded bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          {loadingCandidates ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : candidates.length === 0 ? (
            <p className="text-sm text-gray-500">
              No lapsed patients matching this campaign right now.
            </p>
          ) : (
            <ul className="border rounded divide-y bg-white">
              {candidates.map((c) => (
                <li key={c.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    checked={picked.has(c.id)}
                    onChange={() => togglePick(c.id)}
                    className="h-4 w-4"
                  />
                  <div className="flex-1">
                    <div className="font-medium">
                      {(c.first_name || '') + ' ' + (c.last_name || '')}
                    </div>
                    <div className="text-xs text-gray-500">
                      Last visit {Math.round(Number(c.days_since_last))} days ago
                      {c.communication_preference && ` · prefers ${c.communication_preference}`}
                    </div>
                  </div>
                  <div className="text-xs text-gray-400">
                    {c.email || c.phone || '—'}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
