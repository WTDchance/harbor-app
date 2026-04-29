// W51 D6 — phone number provisioning UI.
'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface Number { phone_number: string; sid: string }
interface Available { phoneNumber: string; friendlyName: string; locality: string; region: string }

export default function PhoneSettingsPage() {
  const [current, setCurrent] = useState<Number[] | null>(null)
  const [areaCode, setAreaCode] = useState('')
  const [results, setResults] = useState<Available[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [claiming, setClaiming] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    const r = await fetch('/api/reception/phone/list')
    const j = await r.json()
    if (r.ok) setCurrent(j.numbers ?? [])
  }
  useEffect(() => { void load() }, [])

  async function search() {
    setSearching(true); setError(null)
    try {
      const r = await fetch(`/api/reception/phone/search?area_code=${encodeURIComponent(areaCode)}&limit=10`)
      const j = await r.json()
      if (!r.ok) setError(j.message || j.error || 'Search failed')
      else setResults(j.numbers ?? [])
    } finally { setSearching(false) }
  }

  async function claim(num: string) {
    setClaiming(num); setError(null)
    try {
      const r = await fetch('/api/reception/phone/claim', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone_number: num }),
      })
      const j = await r.json()
      if (!r.ok) setError(j.message || j.error || 'Claim failed')
      else { setResults(null); setAreaCode(''); void load() }
    } finally { setClaiming(null) }
  }

  async function release(sid: string) {
    if (!confirm('Release this number? Calls will stop being routed to Harbor.')) return
    await fetch(`/api/reception/phone/release/${sid}`, { method: 'DELETE' })
    void load()
  }

  return (
    <div className="max-w-3xl mx-auto p-6">
      <Link href="/dashboard/settings" className="text-sm text-gray-500 hover:text-gray-700">← Back to settings</Link>
      <h1 className="text-2xl font-semibold text-gray-900 mt-2">Phone numbers</h1>
      <p className="text-sm text-gray-500 mt-1">The number you publish to patients. Inbound calls forward to your AI receptionist.</p>

      <h2 className="text-sm font-semibold text-gray-900 mt-6 mb-2">Current</h2>
      {current === null ? <div className="text-sm text-gray-400">Loading…</div> :
       current.length === 0 ? (
        <div className="bg-white border border-dashed border-gray-300 rounded-xl p-6 text-center text-sm text-gray-500">
          No phone number yet. Search and claim one below.
        </div>
       ) : (
        <div className="bg-white border border-gray-200 rounded-xl divide-y">
          {current.map(n => (
            <div key={n.sid} className="px-4 py-3 flex items-center justify-between">
              <div className="font-mono text-sm">{n.phone_number}</div>
              <button onClick={() => release(n.sid)} className="text-xs text-red-600 hover:text-red-800">Release</button>
            </div>
          ))}
        </div>
      )}

      <h2 className="text-sm font-semibold text-gray-900 mt-8 mb-2">Claim a new number</h2>
      <div className="bg-white border border-gray-200 rounded-xl p-4 flex gap-2 items-center">
        <input value={areaCode} onChange={e => setAreaCode(e.target.value.replace(/\D/g, '').slice(0, 3))}
          placeholder="Area code (e.g. 503)"
          className="border border-gray-300 rounded px-3 py-1.5 text-sm w-40" />
        <button onClick={search} disabled={searching}
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-3 py-1.5 rounded-md disabled:opacity-50">
          {searching ? 'Searching…' : 'Search'}
        </button>
      </div>
      {error && <div className="text-sm text-red-600 mt-2">{error}</div>}
      {results && (
        <div className="bg-white border border-gray-200 rounded-xl divide-y mt-3">
          {results.length === 0 && <div className="px-4 py-4 text-sm text-gray-500 text-center">No numbers in {areaCode || 'this region'} right now.</div>}
          {results.map(n => (
            <div key={n.phoneNumber} className="px-4 py-3 flex items-center justify-between">
              <div>
                <div className="font-mono text-sm">{n.phoneNumber}</div>
                <div className="text-xs text-gray-500">{n.locality}, {n.region}</div>
              </div>
              <button onClick={() => claim(n.phoneNumber)} disabled={claiming === n.phoneNumber}
                className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-3 py-1.5 rounded-md disabled:opacity-50">
                {claiming === n.phoneNumber ? 'Claiming…' : 'Claim'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
