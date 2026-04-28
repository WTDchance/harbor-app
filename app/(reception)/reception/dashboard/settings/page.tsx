// app/(reception)/reception/dashboard/settings/page.tsx
//
// W48 T5 — practice settings (name, owner contact, phone hours).
// Reuses the existing /api/practice/settings endpoint for v1.

'use client'

import { useEffect, useState } from 'react'

export default function ReceptionSettingsPage() {
  const [name, setName] = useState('')
  const [ownerEmail, setOwnerEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [hours, setHours] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedNote, setSavedNote] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/aws/whoami', { credentials: 'include' })
        if (res.ok) {
          const j = await res.json()
          setName(j.practice?.name || '')
          setOwnerEmail(j.email || '')
        }
      } finally { setLoading(false) }
    })()
  }, [])

  async function save() {
    setSaving(true); setSavedNote(null)
    try {
      await fetch('/api/practice/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, owner_email: ownerEmail, phone, hours }),
      })
      setSavedNote('Saved.'); setTimeout(() => setSavedNote(null), 3000)
    } finally { setSaving(false) }
  }

  if (loading) return <p className="p-6 text-sm text-gray-500">Loading…</p>
  return (
    <div className="max-w-md mx-auto p-6 space-y-3">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <label className="block text-sm">
        Practice name
        <input value={name} onChange={(e) => setName(e.target.value)}
               className="block w-full border rounded px-2 py-1 mt-1" />
      </label>
      <label className="block text-sm">
        Owner email
        <input type="email" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)}
               className="block w-full border rounded px-2 py-1 mt-1" />
      </label>
      <label className="block text-sm">
        Practice phone
        <input value={phone} onChange={(e) => setPhone(e.target.value)}
               placeholder="+1 555 555 1234"
               className="block w-full border rounded px-2 py-1 mt-1" />
      </label>
      <label className="block text-sm">
        Phone hours (free-form)
        <textarea value={hours} onChange={(e) => setHours(e.target.value)} rows={3}
                  placeholder="Mon-Fri 9am-5pm Pacific"
                  className="block w-full border rounded px-2 py-1 mt-1" />
      </label>

      <button onClick={save} disabled={saving}
              className="bg-[#1f375d] text-white px-3 py-1.5 rounded text-sm disabled:opacity-50">
        {saving ? 'Saving…' : 'Save'}
      </button>
      {savedNote && <p className="text-sm text-green-700">{savedNote}</p>}
    </div>
  )
}
