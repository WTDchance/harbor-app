// app/portal/home/page.tsx — patient's portal dashboard.

'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Calendar, FileText, Target, CheckCircle2, Clock, Video } from 'lucide-react'

type Appt = {
  id: string
  appointment_date: string
  appointment_time: string
  duration_minutes: number
  appointment_type: string | null
  status: string
  telehealth_room_slug: string | null
}
type Consent = { id: string; consent_type: string; document_name: string | null; status: string; signed_at: string | null }
type Goal = { id: string; text: string }
type Plan = { id: string; title: string; presenting_problem: string | null; goals: Goal[]; frequency: string | null; start_date: string | null }
type Me = {
  patient: { id: string; first_name: string; last_name: string; email: string | null; phone: string | null }
  practice: { id: string; name: string; phone_number: string | null }
  appointments: Appt[]
  consents: Consent[]
  active_treatment_plan: Plan | null
}

const CONSENT_LABELS: Record<string, string> = {
  hipaa_npp: 'HIPAA Notice of Privacy Practices',
  informed_consent: 'Informed Consent to Treatment',
  financial_agreement: 'Financial Agreement',
  telehealth_consent: 'Telehealth Consent',
  sms_consent: 'SMS Communication Consent',
}

export default function PortalHome() {
  const router = useRouter()
  const [me, setMe] = useState<Me | null>(null)
  const [loading, setLoading] = useState(true)
  const [signingName, setSigningName] = useState('')
  const [signing, setSigning] = useState<string | null>(null)

  async function load() {
    try {
      const res = await fetch('/api/portal/me')
      if (res.status === 401) { router.replace('/portal/login'); return }
      const json = await res.json()
      setMe(json)
      setSigningName(`${json.patient?.first_name ?? ''} ${json.patient?.last_name ?? ''}`.trim())
    } finally { setLoading(false) }
  }
  useEffect(() => { load() /* eslint-disable-line */ }, [])

  async function signConsent(id: string) {
    if (!signingName.trim()) { alert('Type your full name to sign'); return }
    setSigning(id)
    try {
      const res = await fetch(`/api/portal/consents/${id}/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signed_by_name: signingName.trim() }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Sign failed')
      await load()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Sign failed')
    } finally { setSigning(null) }
  }

  if (loading) return <div className="max-w-3xl mx-auto p-8 text-sm text-gray-500">Loading…</div>
  if (!me) return null

  const pendingConsents = me.consents.filter((c) => c.status === 'pending')

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Welcome, {me.patient.first_name}</h1>
        <p className="text-sm text-gray-500 mt-1">
          {me.practice.name}
          {me.practice.phone_number && <> · {me.practice.phone_number}</>}
        </p>
      </div>

      {/* Upcoming appointments */}
      <div className="bg-white border rounded-lg p-5 shadow-sm">
        <h2 className="font-semibold text-gray-900 flex items-center gap-2 mb-3">
          <Calendar className="w-4 h-4 text-gray-500" />
          Upcoming appointments
        </h2>
        {me.appointments.length === 0 ? (
          <p className="text-sm text-gray-500">No upcoming appointments.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {me.appointments.map((a) => (
              <li key={a.id} className="py-2 flex items-center gap-3">
                <div className="flex-1">
                  <div className="text-sm font-medium text-gray-900">
                    {new Date(a.appointment_date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}
                  </div>
                  <div className="text-xs text-gray-500 flex items-center gap-1.5 mt-0.5">
                    <Clock className="w-3 h-3" />
                    {a.appointment_time.slice(0, 5)} · {a.duration_minutes} min
                    {a.appointment_type && <> · {a.appointment_type.replace('-', ' ')}</>}
                    <span className={`ml-2 px-2 py-0.5 rounded-full text-[10px] font-medium ${
                      a.status === 'confirmed' ? 'bg-green-100 text-green-800'
                        : a.status === 'cancelled' ? 'bg-red-100 text-red-800'
                        : 'bg-blue-100 text-blue-800'
                    }`}>{a.status}</span>
                  </div>
                </div>
                {a.telehealth_room_slug && (
                  <a
                    href={`https://meet.jit.si/${a.telehealth_room_slug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs bg-blue-600 hover:bg-blue-700 text-white px-2.5 py-1 rounded-md"
                  >
                    <Video className="w-3 h-3" />
                    Join video
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Consents — pending first */}
      <div className="bg-white border rounded-lg p-5 shadow-sm">
        <h2 className="font-semibold text-gray-900 flex items-center gap-2 mb-3">
          <FileText className="w-4 h-4 text-gray-500" />
          Forms &amp; agreements
        </h2>
        {pendingConsents.length > 0 && (
          <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <div className="text-sm font-medium text-amber-900 mb-2">
              {pendingConsents.length} form{pendingConsents.length === 1 ? '' : 's'} awaiting your signature
            </div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Sign as (type your full name):</label>
            <input
              value={signingName}
              onChange={(e) => setSigningName(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 mb-3"
            />
            {pendingConsents.map((c) => (
              <div key={c.id} className="flex items-center justify-between py-1">
                <div className="text-sm text-gray-900">{CONSENT_LABELS[c.consent_type] || c.consent_type}</div>
                <button
                  type="button"
                  onClick={() => signConsent(c.id)}
                  disabled={signing === c.id || !signingName.trim()}
                  className="inline-flex items-center gap-1 text-xs bg-teal-600 hover:bg-teal-700 text-white px-2.5 py-1 rounded-md disabled:opacity-50"
                >
                  {signing === c.id ? 'Signing…' : 'Sign'}
                </button>
              </div>
            ))}
          </div>
        )}
        <ul className="divide-y divide-gray-100">
          {me.consents.filter((c) => c.status === 'signed').map((c) => (
            <li key={c.id} className="py-2 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <div className="flex-1">
                <div className="text-sm text-gray-900">{CONSENT_LABELS[c.consent_type] || c.consent_type}</div>
                {c.signed_at && (
                  <div className="text-xs text-gray-500">Signed {new Date(c.signed_at).toLocaleDateString()}</div>
                )}
              </div>
            </li>
          ))}
          {me.consents.length === 0 && <li className="py-2 text-sm text-gray-500">No forms on file.</li>}
        </ul>
      </div>

      {/* Active treatment plan (read-only) */}
      {me.active_treatment_plan && (
        <div className="bg-white border rounded-lg p-5 shadow-sm">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2 mb-3">
            <Target className="w-4 h-4 text-gray-500" />
            Your treatment plan
          </h2>
          <div className="text-sm font-medium text-gray-900">{me.active_treatment_plan.title}</div>
          {me.active_treatment_plan.presenting_problem && (
            <p className="text-sm text-gray-700 mt-1">{me.active_treatment_plan.presenting_problem}</p>
          )}
          {me.active_treatment_plan.goals && me.active_treatment_plan.goals.length > 0 && (
            <div className="mt-3">
              <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">Goals</div>
              <ul className="space-y-1">
                {me.active_treatment_plan.goals.map((g, i) => (
                  <li key={g.id ?? i} className="text-sm text-gray-800 flex items-start gap-2">
                    <span className="text-teal-600 mt-0.5">•</span>
                    <span>{g.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {me.active_treatment_plan.frequency && (
            <div className="mt-3 text-xs text-gray-500">Frequency: {me.active_treatment_plan.frequency}</div>
          )}
        </div>
      )}
    </div>
  )
}
