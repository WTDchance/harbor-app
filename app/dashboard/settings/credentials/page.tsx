// app/dashboard/settings/credentials/page.tsx
//
// W49 T4 — per-therapist credentialing settings. License + NPI +
// CAQH + DEA fields plus continuing-education tracker.

'use client'

import { useEffect, useState } from 'react'

type Credentials = {
  npi: string | null
  license_type: string | null
  license_number: string | null
  license_state: string | null
  license_expires_at: string | null
  caqh_id: string | null
  dea_number: string | null
}

type Course = {
  id: string
  course_name: string
  provider: string | null
  completion_date: string
  hours: number
  certificate_url: string | null
  audit_year: number
  notes: string | null
}

const LICENSE_TYPES = ['LCSW', 'LPC', 'LMFT', 'PsyD', 'PhD', 'MD (psychiatry)', 'LMHC', 'Other']

export default function CredentialsPage() {
  const [creds, setCreds] = useState<Credentials | null>(null)
  const [year, setYear] = useState<number>(new Date().getUTCFullYear())
  const [courses, setCourses] = useState<Course[]>([])
  const [totalHours, setTotalHours] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedNote, setSavedNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // CE form
  const [courseName, setCourseName] = useState('')
  const [provider, setProvider] = useState('')
  const [completionDate, setCompletionDate] = useState('')
  const [hours, setHours] = useState('')
  const [certificateUrl, setCertificateUrl] = useState('')

  async function load() {
    try {
      const [credsRes, ceRes] = await Promise.all([
        fetch('/api/ehr/me/credentials'),
        fetch(`/api/ehr/me/continuing-education?year=${year}`),
      ])
      if (credsRes.ok) setCreds((await credsRes.json()).credentials || {})
      if (ceRes.ok) {
        const j = await ceRes.json()
        setCourses(j.courses || [])
        setTotalHours(j.total_hours || 0)
      }
    } finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [year])

  function update(patch: Partial<Credentials>) {
    setCreds({ ...(creds ?? {} as Credentials), ...patch })
  }

  async function save() {
    if (!creds) return
    setSaving(true); setError(null); setSavedNote(null)
    try {
      const res = await fetch('/api/ehr/me/credentials', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(creds),
      })
      if (!res.ok) throw new Error('Save failed')
      setSavedNote('Saved.')
      setTimeout(() => setSavedNote(null), 3000)
    } catch (e) {
      setError((e as Error).message)
    } finally { setSaving(false) }
  }

  async function addCourse(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      const res = await fetch('/api/ehr/me/continuing-education', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          course_name: courseName,
          provider: provider || undefined,
          completion_date: completionDate,
          hours: Number(hours),
          certificate_url: certificateUrl || undefined,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || 'Add failed')
      }
      setCourseName(''); setProvider(''); setCompletionDate('')
      setHours(''); setCertificateUrl('')
      await load()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  if (loading) return <p className="p-4 text-sm text-gray-500">Loading…</p>
  const licenseExpiringSoon = creds?.license_expires_at && new Date(creds.license_expires_at).getTime() - Date.now() < 30 * 86_400_000
  const licenseExpired      = creds?.license_expires_at && new Date(creds.license_expires_at).getTime() < Date.now()

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">My credentials</h1>
        <p className="text-sm text-gray-600 mt-1">
          License + NPI + CAQH + DEA + continuing-education tracker.
          Practice admins see this rolled up.
        </p>
      </div>

      {error && <div className="rounded bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{error}</div>}
      {savedNote && <div className="rounded bg-green-50 border border-green-200 px-3 py-2 text-sm text-green-700">{savedNote}</div>}

      {(licenseExpired || licenseExpiringSoon) && (
        <div className={`rounded border px-3 py-2 text-sm ${licenseExpired ? 'bg-red-50 border-red-200 text-red-800' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
          {licenseExpired ? 'Your license is expired.' : 'Your license expires within 30 days.'} Update the date below if you've renewed.
        </div>
      )}

      <section className="rounded border bg-white p-4 space-y-3">
        <h2 className="font-medium">License</h2>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-sm">
            License type
            <select value={creds?.license_type || ''}
                    onChange={(e) => update({ license_type: e.target.value || null })}
                    className="block w-full border rounded px-2 py-1 mt-1">
              <option value="">—</option>
              {LICENSE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="text-sm">
            License #
            <input value={creds?.license_number || ''}
                   onChange={(e) => update({ license_number: e.target.value || null })}
                   className="block w-full border rounded px-2 py-1 mt-1" />
          </label>
          <label className="text-sm">
            State
            <input value={creds?.license_state || ''}
                   onChange={(e) => update({ license_state: e.target.value.toUpperCase() || null })}
                   maxLength={2}
                   className="block w-full border rounded px-2 py-1 mt-1" />
          </label>
          <label className="text-sm">
            Expires
            <input type="date" value={creds?.license_expires_at || ''}
                   onChange={(e) => update({ license_expires_at: e.target.value || null })}
                   className="block w-full border rounded px-2 py-1 mt-1" />
          </label>
        </div>
      </section>

      <section className="rounded border bg-white p-4 space-y-3">
        <h2 className="font-medium">Identifiers</h2>
        <label className="block text-sm">
          NPI
          <input value={creds?.npi || ''}
                 onChange={(e) => update({ npi: e.target.value || null })}
                 className="block w-full border rounded px-2 py-1 mt-1" />
        </label>
        <label className="block text-sm">
          CAQH ID
          <input value={creds?.caqh_id || ''}
                 onChange={(e) => update({ caqh_id: e.target.value || null })}
                 className="block w-full border rounded px-2 py-1 mt-1" />
        </label>
        <label className="block text-sm">
          DEA # <span className="text-xs text-gray-500">(prescribers only)</span>
          <input value={creds?.dea_number || ''}
                 onChange={(e) => update({ dea_number: e.target.value || null })}
                 className="block w-full border rounded px-2 py-1 mt-1" />
        </label>
      </section>

      <button onClick={save} disabled={saving}
              className="bg-[#1f375d] text-white px-3 py-1.5 rounded text-sm disabled:opacity-50">
        {saving ? 'Saving…' : 'Save credentials'}
      </button>

      <section className="rounded border bg-white p-4 space-y-3">
        <div className="flex justify-between items-end">
          <div>
            <h2 className="font-medium">Continuing education ({year})</h2>
            <p className="text-xs text-gray-500">Total hours this year: <strong>{totalHours.toFixed(1)}</strong></p>
          </div>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))}
                  className="border rounded px-2 py-1 text-xs">
            {[year + 1, year, year - 1, year - 2].map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>

        <form onSubmit={addCourse} className="grid grid-cols-2 gap-2">
          <input value={courseName} onChange={(e) => setCourseName(e.target.value)}
                 placeholder="Course name" required
                 className="col-span-2 border rounded px-2 py-1 text-sm" />
          <input value={provider} onChange={(e) => setProvider(e.target.value)}
                 placeholder="Provider (optional)"
                 className="border rounded px-2 py-1 text-sm" />
          <input type="date" value={completionDate} onChange={(e) => setCompletionDate(e.target.value)}
                 required
                 className="border rounded px-2 py-1 text-sm" />
          <input type="number" value={hours} onChange={(e) => setHours(e.target.value)}
                 placeholder="Hours" min={0.5} step={0.5} required
                 className="border rounded px-2 py-1 text-sm" />
          <input value={certificateUrl} onChange={(e) => setCertificateUrl(e.target.value)}
                 placeholder="Certificate URL (optional)"
                 className="border rounded px-2 py-1 text-sm" />
          <button type="submit"
                  className="col-span-2 bg-[#1f375d] text-white px-3 py-1 rounded text-sm">
            Add course
          </button>
        </form>

        {courses.length === 0 ? (
          <p className="text-sm text-gray-500">No courses logged for {year}.</p>
        ) : (
          <ul className="border rounded divide-y">
            {courses.map((c) => (
              <li key={c.id} className="px-3 py-2 text-sm">
                <div className="flex justify-between gap-2">
                  <span className="font-medium">{c.course_name}</span>
                  <span className="text-xs text-gray-500">{c.completion_date} · {c.hours}h</span>
                </div>
                {c.provider && <div className="text-xs text-gray-500">{c.provider}</div>}
                {c.certificate_url && (
                  <a href={c.certificate_url} target="_blank" rel="noopener noreferrer"
                     className="text-xs text-[#1f375d] hover:underline">Certificate</a>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
