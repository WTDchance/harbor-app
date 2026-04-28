// app/(reception)/reception/dashboard/api-keys/page.tsx
//
// W48 T5 — Reception API keys management. List + create (one-time
// plaintext display) + revoke.

'use client'

import { useEffect, useState } from 'react'

type Key = {
  id: string
  key_prefix: string
  scopes: string[]
  created_at: string
  last_used_at: string | null
  revoked_at: string | null
}

const ALL_SCOPES = [
  'agents:read', 'agents:write',
  'calls:read',
  'appointments:read', 'appointments:write',
]

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<Key[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [scopes, setScopes] = useState<string[]>(['agents:read', 'calls:read'])
  const [newKey, setNewKey] = useState<{ plaintext: string; prefix: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    try {
      const res = await fetch('/api/reception/api-keys')
      if (!res.ok) throw new Error(`Failed (${res.status})`)
      const j = await res.json()
      setKeys(j.keys || [])
    } catch (e) {
      setError((e as Error).message)
    } finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])

  function toggleScope(s: string) {
    setScopes(scopes.includes(s) ? scopes.filter((x) => x !== s) : [...scopes, s])
  }

  async function create() {
    setCreating(true); setError(null)
    try {
      const res = await fetch('/api/reception/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scopes }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Failed')
      setNewKey({ plaintext: j.plaintext, prefix: j.prefix })
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally { setCreating(false) }
  }

  async function revoke(id: string) {
    if (!confirm('Revoke this key? Any integration using it will stop working immediately.')) return
    await fetch(`/api/reception/api-keys/${id}`, { method: 'DELETE' })
    await load()
  }

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">API keys</h1>
        <p className="text-sm text-gray-600 mt-1">
          Mint keys for your EHR integration. The plaintext is shown
          once at creation; we only store the hash.
        </p>
      </div>

      {newKey && (
        <div className="rounded border border-amber-300 bg-amber-50 p-3 space-y-2">
          <p className="text-sm font-medium text-amber-900">Save this key now — it will never be shown again.</p>
          <div className="rounded bg-white border p-2 font-mono text-xs break-all">{newKey.plaintext}</div>
          <div className="flex gap-2 text-xs">
            <button onClick={() => navigator.clipboard.writeText(newKey.plaintext)}
                    className="text-[#1f375d] hover:underline">Copy</button>
            <button onClick={() => setNewKey(null)} className="text-gray-500 hover:underline">Dismiss</button>
          </div>
        </div>
      )}

      <section className="rounded border bg-white p-4 space-y-3">
        <h2 className="font-medium">New key</h2>
        <div className="flex flex-wrap gap-1.5">
          {ALL_SCOPES.map((s) => {
            const on = scopes.includes(s)
            return (
              <button key={s} onClick={() => toggleScope(s)}
                      className={`text-xs px-2 py-1 rounded-full border ${on ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-700 border-gray-300'}`}>
                {s}
              </button>
            )
          })}
        </div>
        <button onClick={create} disabled={creating || scopes.length === 0}
                className="bg-[#1f375d] text-white px-3 py-1.5 rounded text-sm disabled:opacity-50">
          {creating ? 'Creating…' : 'Create key'}
        </button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </section>

      <section>
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-2">Existing keys</h2>
        {loading ? <p className="text-sm text-gray-500">Loading…</p>
        : keys.length === 0 ? <p className="text-sm text-gray-500">No keys yet.</p>
        : (
          <ul className="border rounded divide-y bg-white">
            {keys.map((k) => (
              <li key={k.id} className={`px-3 py-2 text-sm ${k.revoked_at ? 'opacity-60' : ''}`}>
                <div className="flex justify-between items-start gap-2">
                  <div>
                    <div className="font-mono">{k.key_prefix}…</div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {k.scopes.join(', ') || 'no scopes'} ·
                      Created {new Date(k.created_at).toLocaleDateString()}
                      {k.last_used_at && <> · Last used {new Date(k.last_used_at).toLocaleDateString()}</>}
                      {k.revoked_at && <> · Revoked {new Date(k.revoked_at).toLocaleDateString()}</>}
                    </div>
                  </div>
                  {!k.revoked_at && (
                    <button onClick={() => revoke(k.id)}
                            className="text-xs text-red-600 hover:underline">Revoke</button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
