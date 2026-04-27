"use client"

// app/dashboard/page.tsx
// Wave 36 — The Today screen. Phone-first dashboard for therapists.
//
// Vision (Chance, in his own words):
//   "Therapist just has to do therapy. Our system is easy and intuitive
//    enough they can manage their practice from their phone."
//
// Layout (top → bottom, prioritized for thumb scrolling):
//   1. AI Morning Brief — Sonnet reads the day's state in 90 seconds
//   2. Today's schedule — each appointment is a tappable card with
//      patient summary + draft-note + view-patient quick actions
//   3. Needs attention — only shown when non-empty: notes to sign,
//      crisis flags, pending consents about to expire, etc.
//      EVERY item explains WHY it needs attention (anti-Valiant noise).
//   4. Recent activity — last 10 patient interactions
//
// Per-patient quick actions on each appointment card:
//   - "Pre-session brief" → AI continuity summary
//   - "Draft note" → opens note editor (SOAP/DAP/BIRP per patient pref)
//   - "View patient" → patient detail page
//
// Note format: each patient has a preferred note format
// (ehr_progress_notes.note_format: soap | dap | birp | girp | narrative).
// Default soap; therapist can change per-patient on the editor.

import { useState, useEffect, useMemo } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import {
  Sparkles, RefreshCw, Calendar, Phone, Video, Clock,
  AlertTriangle, FileText, MessageSquare, ChevronRight,
  CheckCircle2, Mic, ClipboardList, Activity, ArrowRight, Target,
} from "lucide-react"
import { PatientSummaryDrawer } from "@/components/ehr/PatientSummaryDrawer"

type Appointment = {
  id: string
  patient_id: string
  patient_first_name: string | null
  patient_last_name: string | null
  scheduled_for: string
  duration_minutes: number | null
  appointment_type: string | null
  status: string
  telehealth_room_slug: string | null
  note_status?: string | null
  intake_completed?: boolean
}

type AttentionItem = {
  id: string
  kind:
    | 'assessment_overdue'
    | 'treatment_plan_review'
    | 'note_unsigned'
    | 'appointment_missing_note'
    // (legacy kinds kept so older clients don't break during deploy)
    | 'crisis'
    | 'unread_message'
    | 'consent_expiring'
    | 'eligibility_failed'
    | 'missed_call'
  /** New shape (Wave 38 M3): bold patient name. */
  label?: string
  /** Legacy field — falls back to label when missing. */
  title?: string
  why: string
  /** New shape (Wave 38 M3). */
  action_url?: string
  /** Legacy field — falls back to action_url when missing. */
  href?: string
  patient_id?: string | null
  patient_name?: string | null
  severity: 'info' | 'warn' | 'urgent'
}

type ActivityItem = {
  id: string
  kind: string
  patient_id?: string | null
  patient_name?: string | null
  description: string
  occurred_at: string
}

type TodayData = {
  appointments: Appointment[]
  attention: AttentionItem[]
  attention_overflow?: number
  activity: ActivityItem[]
  practice_name: string
  greeting: string
  drafts_pending: number
  crisis_count: number
  unread_messages: number
}

const ATTENTION_TONES: Record<AttentionItem['severity'], { bg: string; border: string; text: string; icon: string }> = {
  info:   { bg: 'bg-blue-50',  border: 'border-blue-200',  text: 'text-blue-900',  icon: 'text-blue-600' },
  warn:   { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-900', icon: 'text-amber-600' },
  urgent: { bg: 'bg-red-50',   border: 'border-red-200',   text: 'text-red-900',   icon: 'text-red-600' },
}

export default function TodayPage() {
  const router = useRouter()
  const [data, setData] = useState<TodayData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [brief, setBrief] = useState<string | null>(null)
  const [briefLoading, setBriefLoading] = useState(false)
  const [briefError, setBriefError] = useState<string | null>(null)
  // M1 — drawer state lives at the page level so we can render a single
  // overlay that any AppointmentCard can open.
  const [drawerPatient, setDrawerPatient] = useState<{ id: string; name: string | null } | null>(null)

  async function load() {
    try {
      setLoading(true)
      const r = await fetch('/api/dashboard/today')
      if (r.status === 401) { router.replace('/login'); return }
      if (!r.ok) throw new Error(`Failed to load today (${r.status})`)
      setData(await r.json())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed')
    } finally { setLoading(false) }
  }
  useEffect(() => { load() /* eslint-disable-line */ }, [])

  async function loadBrief() {
    setBriefLoading(true)
    setBriefError(null)
    try {
      const r = await fetch('/api/dashboard/ai-brief')
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        throw new Error(j.error || `HTTP ${r.status}`)
      }
      const j = await r.json()
      setBrief(j.brief || j.summary || '')
    } catch (err) {
      setBriefError(err instanceof Error ? err.message : 'Failed to load brief')
    } finally { setBriefLoading(false) }
  }
  useEffect(() => { loadBrief() /* eslint-disable-line */ }, [])

  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center text-gray-500">Loading your day…</div>
  )
  if (error || !data) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center text-red-600">{error || 'Failed to load'}</div>
  )

  const todayString = new Date().toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric',
  })

  return (
    <div className="min-h-screen bg-gray-50 pb-12">
      {/* Header — sticky on mobile, dense on desktop */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-4 py-5">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs text-gray-500 uppercase tracking-wide">{todayString}</p>
              <h1 className="text-xl sm:text-2xl font-semibold text-gray-900">{data.greeting}</h1>
              <p className="text-xs text-gray-500 mt-0.5">{data.practice_name}</p>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <PillStat label="Today" value={data.appointments.length} tone="teal" />
              {data.drafts_pending > 0 && <PillStat label="Drafts" value={data.drafts_pending} tone="amber" />}
              {data.crisis_count > 0 && <PillStat label="Crisis" value={data.crisis_count} tone="red" />}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-5 space-y-5">

        {/* AI Morning Brief */}
        <div className="bg-gradient-to-br from-teal-50 via-white to-teal-50 border border-teal-200 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-teal-600 flex items-center justify-center text-white">
                <Sparkles className="w-3.5 h-3.5" />
              </div>
              <span className="text-sm font-semibold text-teal-900">Your day in 90 seconds</span>
            </div>
            <button
              onClick={loadBrief}
              disabled={briefLoading}
              className="inline-flex items-center gap-1 text-xs text-teal-700 hover:text-teal-900 disabled:opacity-50"
              aria-label="Regenerate brief"
            >
              <RefreshCw className={`w-3 h-3 ${briefLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
          {briefLoading && <p className="text-sm text-teal-800 italic">Reading your practice…</p>}
          {briefError && <p className="text-sm text-amber-800 italic">{briefError}</p>}
          {brief && !briefLoading && (
            <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">{brief}</p>
          )}
        </div>

        {/* Needs attention */}
        {data.attention.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-2 px-1">
              Needs your attention
            </h2>
            <div className="space-y-2">
              {data.attention.map(item => (
                <AttentionRow key={item.id} item={item} />
              ))}
              {data.attention_overflow && data.attention_overflow > 0 ? (
                <div className="text-xs text-gray-500 px-1 italic">
                  and {data.attention_overflow} more — refresh after working through these.
                </div>
              ) : null}
            </div>
          </div>
        )}

        {/* Today's schedule */}
        <div>
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-2 px-1">
            Today's schedule
          </h2>
          {data.appointments.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-xl p-6 text-center text-sm text-gray-500">
              No appointments today. Take a breath.
            </div>
          ) : (
            <div className="space-y-2">
              {data.appointments.map(a => (
                <AppointmentCard
                  key={a.id}
                  appt={a}
                  onOpenSummary={(id, name) => setDrawerPatient({ id, name })}
                />
              ))}
            </div>
          )}
        </div>

        {/* Recent activity */}
        {data.activity.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-2 px-1">
              Recent activity
            </h2>
            <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
              {data.activity.slice(0, 10).map(a => (
                <ActivityRow key={a.id} item={a} />
              ))}
            </div>
          </div>
        )}

      </div>

      <PatientSummaryDrawer
        open={!!drawerPatient}
        patientId={drawerPatient?.id ?? null}
        patientName={drawerPatient?.name ?? null}
        onClose={() => setDrawerPatient(null)}
      />
    </div>
  )
}

function PillStat({ label, value, tone }: { label: string; value: number; tone: 'teal' | 'amber' | 'red' }) {
  const tones: Record<typeof tone, string> = {
    teal:  'bg-teal-100 text-teal-800 border-teal-200',
    amber: 'bg-amber-100 text-amber-800 border-amber-200',
    red:   'bg-red-100 text-red-800 border-red-200',
  }
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs ${tones[tone]}`}>
      <span className="font-semibold">{value}</span>
      <span className="opacity-80">{label}</span>
    </span>
  )
}

function AttentionRow({ item }: { item: AttentionItem }) {
  const tone = ATTENTION_TONES[item.severity]
  const Icon =
    item.kind === 'crisis' ? AlertTriangle
    : item.kind === 'note_unsigned' ? FileText
    : item.kind === 'unread_message' ? MessageSquare
    : item.kind === 'missed_call' ? Phone
    : item.kind === 'assessment_overdue' ? ClipboardList
    : item.kind === 'treatment_plan_review' ? Target
    : item.kind === 'appointment_missing_note' ? Calendar
    : ClipboardList
  // Wave 38 M3 — new shape uses label + action_url; legacy uses title + href.
  const label = item.label || item.title || 'Needs attention'
  const href = item.action_url || item.href || '#'
  return (
    <Link
      href={href}
      className={`flex items-center gap-3 ${tone.bg} ${tone.border} border rounded-xl px-4 py-3 hover:shadow-sm transition min-h-[56px]`}
    >
      <Icon className={`w-5 h-5 flex-shrink-0 ${tone.icon}`} />
      <div className="flex-1 min-w-0">
        <div className={`text-sm font-semibold ${tone.text} truncate`}>{label}</div>
        <div className="text-xs text-gray-700 mt-0.5">{item.why}</div>
      </div>
      <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
    </Link>
  )
}

function AppointmentCard({
  appt,
  onOpenSummary,
}: {
  appt: Appointment
  onOpenSummary: (patientId: string, patientName: string | null) => void
}) {
  const time = new Date(appt.scheduled_for)
  const timeStr = time.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  const fullName = [appt.patient_first_name, appt.patient_last_name].filter(Boolean).join(' ') || 'Unnamed patient'
  const isTelehealth = !!appt.telehealth_room_slug
  const noteStatus = appt.note_status

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <div className="px-4 py-3 flex items-center gap-3">
        <div className="text-center w-14 flex-shrink-0">
          <div className="text-xs text-gray-500 uppercase tracking-wide">{time.toLocaleString(undefined, { month: 'short' }).slice(0,3)}</div>
          <div className="text-sm font-bold text-gray-900">{timeStr}</div>
        </div>
        <div className="flex-1 min-w-0">
          <Link
            href={`/dashboard/patients/${appt.patient_id}`}
            className="block font-semibold text-gray-900 hover:text-teal-700 truncate"
          >
            {fullName}
          </Link>
          <div className="flex items-center gap-1.5 text-xs text-gray-500 mt-0.5">
            <span>{appt.duration_minutes || 50}m</span>
            {appt.appointment_type && <><span>·</span><span>{appt.appointment_type}</span></>}
            {isTelehealth && <><span>·</span><Video className="w-3 h-3 inline" /><span>Telehealth</span></>}
            {noteStatus === 'draft' && <><span>·</span><span className="text-amber-700">Draft note</span></>}
            {noteStatus === 'signed' && <><span>·</span><span className="text-green-700">Note signed</span></>}
          </div>
        </div>
      </div>
      <div className="border-t border-gray-100 grid grid-cols-3 divide-x divide-gray-100">
        <button
          type="button"
          onClick={() => onOpenSummary(appt.patient_id, fullName)}
          className="px-3 py-2.5 text-xs text-center text-gray-700 hover:bg-gray-50 inline-flex items-center justify-center gap-1.5 min-h-[44px]"
          aria-label={`Open pre-session summary for ${fullName}`}
        >
          <Sparkles className="w-3 h-3 text-teal-600" />
          Summary
        </button>
        <Link
          href={`/dashboard/ehr/notes/new?patient_id=${appt.patient_id}&appointment_id=${appt.id}`}
          className="px-3 py-2.5 text-xs text-center text-gray-700 hover:bg-gray-50 inline-flex items-center justify-center gap-1.5"
        >
          <Mic className="w-3 h-3 text-teal-600" />
          Draft note
        </Link>
        <Link
          href={`/dashboard/patients/${appt.patient_id}`}
          className="px-3 py-2.5 text-xs text-center text-gray-700 hover:bg-gray-50 inline-flex items-center justify-center gap-1.5"
        >
          View
          <ArrowRight className="w-3 h-3" />
        </Link>
      </div>
    </div>
  )
}

function ActivityRow({ item }: { item: ActivityItem }) {
  const when = new Date(item.occurred_at)
  const ago = relativeTime(when)
  return (
    <Link
      href={item.patient_id ? `/dashboard/patients/${item.patient_id}` : '#'}
      className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50"
    >
      <Activity className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-sm text-gray-900 truncate">{item.description}</div>
        {item.patient_name && <div className="text-xs text-gray-500">{item.patient_name}</div>}
      </div>
      <div className="text-xs text-gray-400 flex-shrink-0">{ago}</div>
    </Link>
  )
}

function relativeTime(d: Date): string {
  const ms = Date.now() - d.getTime()
  if (ms < 60_000) return 'just now'
  const m = Math.floor(ms / 60_000)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const days = Math.floor(h / 24)
  if (days < 7) return `${days}d ago`
  return d.toLocaleDateString()
}
