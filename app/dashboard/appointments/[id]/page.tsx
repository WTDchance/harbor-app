// app/dashboard/appointments/[id]/page.tsx
//
// Launch-blocker fix #2 — therapists clicking an appointment in Today's
// schedule were landing on /dashboard/appointments/[id]/telehealth (which
// only exists for telehealth bookings) or a 404. This page is the canonical
// detail view: patient header, Wave 49 flag chips + crisis banner, intake
// status, last signed note, and the four primary actions (Start session,
// Write note, No-show, Cancel).
//
// All data comes from /api/ehr/appointments/[id] which we extended to join
// patient + event_type + last note + flags + intake counts in one round
// trip.

'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, Calendar, Clock, Video, MapPin, FileText, X, AlertTriangle, User as UserIcon } from 'lucide-react'

import PatientFlagChips from '@/components/ehr/PatientFlagChips'
import PatientFlagManager from '@/components/ehr/PatientFlagManager'
import { CrisisSafetyPlanBanner } from '@/components/ehr/CrisisSafetyPlanBanner'
import { PatientSummaryDrawer } from '@/components/ehr/PatientSummaryDrawer'

type Appointment = {
  id: string
  patient_id: string
  scheduled_for: string
  duration_minutes: number
  appointment_type: string
  status: string
  notes: string | null
  cpt_code: string | null
  modifiers: string[] | null
  event_type_id: string | null
  event_type_name: string | null
  event_type_color: string | null
  event_type_default_cpt: string[] | null
  location: string | null
  completed_at: string | null
  patient_first_name: string | null
  patient_last_name: string | null
  patient_dob: string | null
  patient_email: string | null
  patient_phone: string | null
  patient_status: string | null
  insurance_carrier: string | null
  insurance_member_id: string | null
}

type LastNote = {
  id: string
  title: string | null
  note_format: string | null
  status: string
  signed_at: string | null
  cpt_codes: string[] | null
  icd10_codes: string[] | null
  subjective: string | null
  objective: string | null
  assessment: string | null
  plan: string | null
  body: string | null
} | null

interface DetailResponse {
  appointment: Appointment
  last_note: LastNote
  flags: string[]
  intake: { completed: number; pending: number }
}

function ageFromDob(dob: string | null): number | null {
  if (!dob) return null
  const d = new Date(dob)
  if (Number.isNaN(d.getTime())) return null
  const today = new Date()
  let age = today.getFullYear() - d.getFullYear()
  const m = today.getMonth() - d.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < d.getDate())) age--
  return age
}

function formatWhen(iso: string, durationMin: number): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const date = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  return `${date} · ${time} (${durationMin} min)`
}

const STATUS_LABELS: Record<string, string> = {
  scheduled: 'Scheduled',
  confirmed: 'Confirmed',
  completed: 'Completed',
  no_show: 'No-show',
  cancelled: 'Cancelled',
  in_progress: 'In session',
}

export default function AppointmentDetailPage() {
  const params = useParams<{ id: string }>()
  const id = params.id
  const router = useRouter()

  const [data, setData] = useState<DetailResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [acting, setActing] = useState<'no_show' | 'cancelled' | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [showLastNote, setShowLastNote] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const r = await fetch(`/api/ehr/appointments/${id}`)
      const j = await r.json()
      if (!r.ok) {
        setError(j.error || 'Failed to load appointment')
      } else {
        setData(j as DetailResponse)
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to load appointment')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [id])

  async function setStatus(next: 'no_show' | 'cancelled') {
    if (!data) return
    if (!confirm(`Mark this appointment as ${next.replace('_', '-')}?`)) return
    setActing(next)
    try {
      const r = await fetch(`/api/ehr/appointments/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scope: 'this_only', patch: { status: next } }),
      })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        alert(j.error || 'Failed to update appointment')
      } else {
        await load()
      }
    } finally {
      setActing(null)
    }
  }

  if (loading) {
    return (
      <div className="p-6 text-sm text-gray-500">Loading appointment…</div>
    )
  }
  if (error || !data) {
    return (
      <div className="p-6">
        <button onClick={() => router.back()} className="text-sm text-blue-600 hover:underline mb-4 inline-flex items-center gap-1">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <div className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {error || 'Appointment not found.'}
        </div>
      </div>
    )
  }

  const { appointment: a, last_note: lastNote, flags, intake } = data
  const fullName = `${a.patient_first_name ?? ''} ${a.patient_last_name ?? ''}`.trim() || 'Unknown patient'
  const age = ageFromDob(a.patient_dob)
  const isTelehealth = a.appointment_type === 'telehealth'
  const isTerminal = ['completed', 'no_show', 'cancelled'].includes(a.status)
  const inferredCrisisRisk =
    flags.includes('crisis') || flags.includes('high_risk_si') ? 'crisis'
      : flags.includes('moderate_risk') ? 'high'
      : 'low'

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <button onClick={() => router.back()} className="text-sm text-blue-600 hover:underline mb-4 inline-flex items-center gap-1">
        <ArrowLeft className="h-4 w-4" /> Back to schedule
      </button>

      {/* Crisis banner — surfaces empty/missing safety plan when patient is high-risk. */}
      {a.patient_id && (
        <div className="mb-4">
          <CrisisSafetyPlanBanner patientId={a.patient_id} riskLevel={inferredCrisisRisk as any} />
        </div>
      )}

      {/* Patient header */}
      <header className="rounded-lg border border-gray-200 bg-white p-5 mb-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-semibold text-gray-900 truncate">{fullName}</h1>
              {age !== null && <span className="text-sm text-gray-500">· {age} y/o</span>}
              {a.patient_status && a.patient_status !== 'active' && (
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs uppercase tracking-wide text-gray-600">{a.patient_status}</span>
              )}
            </div>
            <div className="mt-1 text-sm text-gray-600 flex items-center gap-3 flex-wrap">
              {a.patient_dob && <span>DOB {new Date(a.patient_dob).toLocaleDateString()}</span>}
              {a.insurance_carrier && (
                <span className="truncate">{a.insurance_carrier}{a.insurance_member_id ? ` · ${a.insurance_member_id}` : ''}</span>
              )}
              {a.patient_phone && <span>{a.patient_phone}</span>}
            </div>
            <div className="mt-2"><PatientFlagChips flags={flags as any} /></div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setDrawerOpen(true)} className="rounded border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 inline-flex items-center gap-1">
              <UserIcon className="h-4 w-4" /> Patient summary
            </button>
            {a.patient_id && (
              <PatientFlagManager patientId={a.patient_id} />
            )}
          </div>
        </div>
      </header>

      {/* Appointment metadata */}
      <section className="rounded-lg border border-gray-200 bg-white p-5 mb-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div
              className="h-2.5 w-2.5 rounded-full border border-gray-300"
              style={a.event_type_color ? { backgroundColor: a.event_type_color } : undefined}
              aria-hidden
            />
            <h2 className="text-base font-medium text-gray-900">{a.event_type_name || a.appointment_type}</h2>
            <span className="rounded bg-gray-100 px-2 py-0.5 text-xs uppercase tracking-wide text-gray-700">
              {STATUS_LABELS[a.status] ?? a.status}
            </span>
          </div>
        </div>
        <dl className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-y-2 gap-x-6 text-sm">
          <div className="flex items-start gap-2">
            <Calendar className="h-4 w-4 text-gray-400 mt-0.5" />
            <div><dt className="text-gray-500">When</dt><dd className="text-gray-900">{formatWhen(a.scheduled_for, a.duration_minutes)}</dd></div>
          </div>
          <div className="flex items-start gap-2">
            {isTelehealth ? <Video className="h-4 w-4 text-gray-400 mt-0.5" /> : <MapPin className="h-4 w-4 text-gray-400 mt-0.5" />}
            <div>
              <dt className="text-gray-500">{isTelehealth ? 'Telehealth' : 'Location'}</dt>
              <dd className="text-gray-900">{isTelehealth ? 'Video session' : (a.location || '—')}</dd>
            </div>
          </div>
          {a.event_type_default_cpt && a.event_type_default_cpt.length > 0 && (
            <div className="flex items-start gap-2">
              <Clock className="h-4 w-4 text-gray-400 mt-0.5" />
              <div>
                <dt className="text-gray-500">Default CPT</dt>
                <dd className="text-gray-900">{a.event_type_default_cpt.join(', ')}</dd>
              </div>
            </div>
          )}
          {a.cpt_code && (
            <div className="flex items-start gap-2">
              <Clock className="h-4 w-4 text-gray-400 mt-0.5" />
              <div>
                <dt className="text-gray-500">CPT (override)</dt>
                <dd className="text-gray-900">{a.cpt_code}{a.modifiers?.length ? ` · mod ${a.modifiers.join(',')}` : ''}</dd>
              </div>
            </div>
          )}
        </dl>
        {a.notes && <p className="mt-3 text-sm text-gray-700 whitespace-pre-line border-t border-gray-100 pt-3">{a.notes}</p>}
      </section>

      {/* Actions */}
      <section className="flex flex-wrap items-center gap-2 mb-4">
        {!isTerminal && isTelehealth && (
          <Link href={`/dashboard/appointments/${a.id}/telehealth`}
                className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 inline-flex items-center gap-1">
            <Video className="h-4 w-4" /> Start session
          </Link>
        )}
        {!isTerminal && !isTelehealth && (
          <button
            onClick={() => setStatus('completed' as any).catch?.(() => {})}
            disabled
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white opacity-90 inline-flex items-center gap-1"
            title="In-person sessions complete on note sign"
          >
            <Clock className="h-4 w-4" /> In-session (sign note to complete)
          </button>
        )}
        <Link
          href={`/dashboard/notes/new?appointment_id=${a.id}&patient_id=${a.patient_id}`}
          className="rounded border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 inline-flex items-center gap-1">
          <FileText className="h-4 w-4" /> Write note
        </Link>
        {!isTerminal && (
          <>
            <button
              onClick={() => setStatus('no_show')}
              disabled={acting !== null}
              className="rounded border border-yellow-300 bg-yellow-50 px-4 py-2 text-sm font-medium text-yellow-800 hover:bg-yellow-100 inline-flex items-center gap-1">
              <AlertTriangle className="h-4 w-4" /> Mark no-show
            </button>
            <button
              onClick={() => setStatus('cancelled')}
              disabled={acting !== null}
              className="rounded border border-red-300 bg-red-50 px-4 py-2 text-sm font-medium text-red-800 hover:bg-red-100 inline-flex items-center gap-1">
              <X className="h-4 w-4" /> Cancel
            </button>
          </>
        )}
      </section>

      {/* Last note (collapsible) */}
      <section className="rounded-lg border border-gray-200 bg-white p-5 mb-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-gray-900">Last note</h3>
          {lastNote && (
            <button onClick={() => setShowLastNote(v => !v)} className="text-xs text-blue-600 hover:underline">
              {showLastNote ? 'Hide' : 'Show'}
            </button>
          )}
        </div>
        {!lastNote && <p className="mt-2 text-sm text-gray-500">No prior signed note.</p>}
        {lastNote && (
          <div className="mt-2 text-sm text-gray-700">
            <div className="text-gray-600">
              <span className="uppercase tracking-wide text-[11px] mr-2">{lastNote.note_format || 'NOTE'}</span>
              <span>{lastNote.title || 'Untitled'}</span>
              {lastNote.signed_at && <span className="ml-2 text-gray-400">· signed {new Date(lastNote.signed_at).toLocaleDateString()}</span>}
            </div>
            {showLastNote && (
              <div className="mt-2 space-y-2 text-gray-800">
                {lastNote.subjective && <p><strong>S:</strong> {lastNote.subjective}</p>}
                {lastNote.objective  && <p><strong>O:</strong> {lastNote.objective}</p>}
                {lastNote.assessment && <p><strong>A:</strong> {lastNote.assessment}</p>}
                {lastNote.plan       && <p><strong>P:</strong> {lastNote.plan}</p>}
                {lastNote.body && <p className="whitespace-pre-line">{lastNote.body}</p>}
                <Link href={`/dashboard/notes/${lastNote.id}`} className="inline-block text-blue-600 hover:underline">Open note →</Link>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Intake forms status */}
      <section className="rounded-lg border border-gray-200 bg-white p-5 mb-4">
        <h3 className="text-sm font-medium text-gray-900">Intake forms</h3>
        <p className="mt-1 text-sm text-gray-700">
          {intake.completed} completed · {intake.pending} pending
        </p>
        {a.patient_id && (
          <Link href={`/dashboard/patients/${a.patient_id}#intake`} className="mt-2 inline-block text-xs text-blue-600 hover:underline">
            Manage intake forms →
          </Link>
        )}
      </section>

      {/* Patient summary drawer */}
      {a.patient_id && (
        <PatientSummaryDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          patientId={a.patient_id}
          patientName={fullName}
        />
      )}
    </div>
  )
}
