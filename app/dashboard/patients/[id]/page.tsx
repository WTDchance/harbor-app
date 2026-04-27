"use client"

// app/dashboard/patients/[id]/page.tsx
// Wave 31 — The Moat: unified, AI-synthesized patient detail page.
//
// Design philosophy:
//   1. AI synthesis at the top. The therapist reads three sentences and
//      knows the whole story. No clicking required.
//   2. Trajectory band. Mood + assessment scores over time, overlaid with
//      appointments. Visual at a glance.
//   3. Action-oriented sections. Each domain (treatment plan, notes,
//      assessments, billing, calls, etc.) is a card the therapist can
//      collapse/expand. Smart defaults: open the things that need attention,
//      collapsed when done.
//   4. Customizable. Therapist saves their preferred section order +
//      open/closed state per-themself in localStorage. No "edit
//      dashboard" config screen — just collapse/move/restore as they go.
//   5. Smart selectors everywhere. Replace dropdowns with typeahead +
//      AI-suggested top-3 (diagnoses, goals, etc.).

import { useState, useEffect, useMemo } from "react"
import { useRouter, useParams } from "next/navigation"
import Link from "next/link"
import {
  ChevronDown, ChevronRight, Edit3, Phone, Mail, Calendar,
  AlertTriangle, ShieldAlert, FileText, Activity, MessageSquare, DollarSign,
  Sparkles, RefreshCw, ExternalLink, ArrowLeft, Settings as SettingsIcon,
  Heart, ClipboardList, Briefcase,
} from "lucide-react"

import { PatientAISummaryCard } from "@/components/ehr/PatientAISummaryCard"
import { TreatmentPlanCard } from "@/components/ehr/TreatmentPlanCard"
import { SafetyPlanCard } from "@/components/ehr/SafetyPlanCard"
import { StanleyBrownPlanEditor } from "@/components/ehr/StanleyBrownPlanEditor"
import { CareTeamChips } from "@/components/CareTeamChips" 
import { CrisisSafetyPlanBanner } from "@/components/ehr/CrisisSafetyPlanBanner"
import { AssessmentsCard } from "@/components/ehr/AssessmentsCard"
import { ConsentsCard } from "@/components/ehr/ConsentsCard"
import { Part2ConsentsCard } from "@/components/ehr/Part2ConsentsCard"
import { BiopsychosocialIntakeCard } from "@/components/ehr/BiopsychosocialIntakeCard"
import { MoodLogsCard } from "@/components/ehr/MoodLogsCard"
import { HomeworkCard } from "@/components/ehr/HomeworkCard"
import { BillingCard } from "@/components/ehr/BillingCard"
import { PortalLinkCard } from "@/components/ehr/PortalLinkCard"
import { PatientProgressNotes } from "@/components/ehr/PatientProgressNotes"
import { ExportPatientButton } from "@/components/ehr/ExportPatientButton"
import { InsuranceCardScanner } from "@/components/ehr/InsuranceCardScanner"

type PatientResp = {
  patient: {
    id: string
    first_name: string | null
    last_name: string | null
    phone: string | null
    email: string | null
    date_of_birth: string | null
    pronouns: string | null
    insurance_provider: string | null
    intake_completed: boolean
    intake_completed_at: string | null
    billing_mode: 'pending' | 'insurance' | 'self_pay' | 'sliding_scale'
    address: string | null
    emergency_contact_name: string | null
    emergency_contact_phone: string | null
    referral_source: string | null
    reason_for_seeking: string | null
    notes: string | null
    risk_level: 'none' | 'low' | 'moderate' | 'high' | 'crisis' | null
    created_at: string
  }
  intake_status: string
  intake_forms?: Array<{
    id: string
    phq9_score: number | null
    phq9_severity: string | null
    gad7_score: number | null
    gad7_severity: string | null
    completed_at: string | null
  }>
  call_logs?: Array<{
    id: string
    summary: string | null
    duration_seconds: number | null
    crisis_detected: boolean
    created_at: string
  }>
  upcoming_appointments?: Array<{
    id: string
    scheduled_for: string
    status: string
  }>
  crisis_alerts?: Array<{
    id: string
    severity: string
    summary: string | null
    created_at: string
  }>
}

type SectionKey =
  | 'continuity' | 'trajectory' | 'treatment_plan' | 'safety_plan'
  | 'biopsychosocial'
  | 'progress_notes' | 'assessments' | 'mood' | 'homework'
  | 'billing' | 'consents' | 'part2_consents' | 'portal' | 'communications'
  | 'demographics' | 'history'

const ALL_SECTIONS: { key: SectionKey; label: string; icon: any; default_open: boolean }[] = [
  { key: 'continuity',    label: 'Continuity',         icon: Sparkles,     default_open: true  },
  { key: 'trajectory',    label: 'Trajectory',         icon: Activity,     default_open: true  },
  { key: 'treatment_plan',label: 'Treatment Plan',     icon: ClipboardList,default_open: true  },
  { key: 'biopsychosocial', label: 'Biopsychosocial',  icon: ClipboardList,default_open: true  },
  { key: 'safety_plan',   label: 'Safety Plan',        icon: AlertTriangle,default_open: false },
  { key: 'progress_notes',label: 'Progress Notes',     icon: FileText,     default_open: true  },
  { key: 'assessments',   label: 'Assessments',        icon: Heart,        default_open: false },
  { key: 'mood',          label: 'Mood',               icon: Heart,        default_open: false },
  { key: 'homework',      label: 'Homework',           icon: Briefcase,    default_open: false },
  { key: 'billing',       label: 'Billing',            icon: DollarSign,   default_open: false },
  { key: 'consents',      label: 'Consents',           icon: FileText,     default_open: false },
  { key: 'part2_consents',label: '42 CFR Part 2 Consents', icon: ShieldAlert,  default_open: false },
  { key: 'portal',        label: 'Patient Portal',     icon: ExternalLink, default_open: false },
  { key: 'communications',label: 'Communications',     icon: MessageSquare,default_open: false },
  { key: 'demographics',  label: 'Demographics',       icon: SettingsIcon, default_open: false },
  { key: 'history',       label: 'Intake History',     icon: ClipboardList,default_open: false },
]

function loadSectionPrefs(patientId: string): Record<SectionKey, boolean> {
  if (typeof window === 'undefined') return {} as Record<SectionKey, boolean>
  try {
    const raw = localStorage.getItem('harbor.patient_sections')
    if (!raw) return {} as Record<SectionKey, boolean>
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : ({} as Record<SectionKey, boolean>)
  } catch { return {} as Record<SectionKey, boolean> }
}

function saveSectionPrefs(prefs: Record<SectionKey, boolean>) {
  if (typeof window === 'undefined') return
  try { localStorage.setItem('harbor.patient_sections', JSON.stringify(prefs)) } catch {}
}

export default function PatientDetailPage() {
  const params = useParams()
  const router = useRouter()
  const patientId = params?.id as string

  const [data, setData] = useState<PatientResp | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [openSections, setOpenSections] = useState<Record<SectionKey, boolean>>({} as any)

  // Initialize section open/closed from localStorage + defaults
  useEffect(() => {
    const stored = loadSectionPrefs(patientId)
    const init: Record<SectionKey, boolean> = {} as any
    for (const s of ALL_SECTIONS) {
      init[s.key] = stored[s.key] !== undefined ? stored[s.key] : s.default_open
    }
    setOpenSections(init)
  }, [patientId])

  function toggleSection(key: SectionKey) {
    setOpenSections(prev => {
      const next = { ...prev, [key]: !prev[key] }
      saveSectionPrefs(next)
      return next
    })
  }

  async function load() {
    try {
      setLoading(true)
      const r = await fetch(`/api/patients/${patientId}`)
      if (!r.ok) throw new Error(`Failed to load patient (${r.status})`)
      setData(await r.json())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally { setLoading(false) }
  }

  useEffect(() => { load() /* eslint-disable-line */ }, [patientId])

  const fullName = useMemo(() => {
    if (!data?.patient) return ''
    return [data.patient.first_name, data.patient.last_name].filter(Boolean).join(' ') || 'Unknown'
  }, [data])

  const ageStr = useMemo(() => {
    const dob = data?.patient.date_of_birth
    if (!dob) return null
    const d = new Date(dob)
    if (isNaN(d.getTime())) return null
    const today = new Date()
    let age = today.getFullYear() - d.getFullYear()
    const m = today.getMonth() - d.getMonth()
    if (m < 0 || (m === 0 && today.getDate() < d.getDate())) age--
    return `${age}`
  }, [data])

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-500">Loading patient…</div>
      </div>
    )
  }
  if (error || !data) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-red-600">{error || 'Patient not found'}</div>
      </div>
    )
  }

  const p = data.patient
  const hasActiveCrisis = (data.crisis_alerts?.length || 0) > 0
  const upcoming = data.upcoming_appointments?.[0]
  const lastIntake = data.intake_forms?.[0]

  return (
    <div className="min-h-screen bg-gray-50 pb-12">
      {/* Sticky header */}
      <div className="sticky top-0 z-20 bg-white border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <button
              onClick={() => router.push('/dashboard/patients')}
              className="p-2 hover:bg-gray-100 rounded-lg text-gray-500"
              aria-label="Back to patients"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              <h1 className="text-xl font-semibold text-gray-900 truncate">{fullName}</h1>
              <div className="flex items-center gap-2 text-xs text-gray-500 mt-0.5">
                {p.pronouns && <span>{p.pronouns}</span>}
                {ageStr && <span>· {ageStr}y</span>}
                {p.date_of_birth && <span>· DOB {new Date(p.date_of_birth).toLocaleDateString()}</span>}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <StatusPill label={p.intake_completed ? 'Intake complete' : 'Intake pending'} tone={p.intake_completed ? 'green' : 'amber'} />
            <StatusPill label={p.billing_mode || 'pending'} tone={p.billing_mode === 'self_pay' ? 'blue' : p.billing_mode === 'insurance' ? 'teal' : 'gray'} />
            {hasActiveCrisis && <StatusPill label="Crisis active" tone="red" />}
            <Link
              href={`/dashboard/patients/${patientId}/edit`}
              className="ml-2 inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              <Edit3 className="w-3.5 h-3.5" />
              Edit
            </Link>
            <ExportPatientButton patientId={patientId} />
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 -mt-2 mb-2">
        <CareTeamChips patientId={patientId} />
      </div>

      {/* Body */}
      <div className="max-w-6xl mx-auto px-6 py-6 space-y-6">

        {/* Crisis banner */}
        {hasActiveCrisis && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <div className="font-semibold text-red-900">Active crisis alert</div>
              <div className="text-sm text-red-800 mt-1">
                {data.crisis_alerts?.[0]?.summary || 'Crisis flag set on this patient. Review safety plan and recent calls.'}
              </div>
            </div>
          </div>
        )}

        {/* Wave 38 / TS10 — high-risk + no-safety-plan banner. */}
        <CrisisSafetyPlanBanner patientId={patientId} riskLevel={data.patient.risk_level} />

        {/* AI Synthesis (the moat) */}
        <PatientAISummaryCard patientId={patientId} />

        {/* Quick context strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <QuickStat
            icon={<Calendar className="w-4 h-4" />}
            label="Next appointment"
            value={upcoming ? new Date(upcoming.scheduled_for).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Not scheduled'}
            tone={upcoming ? 'teal' : 'gray'}
          />
          <QuickStat
            icon={<Heart className="w-4 h-4" />}
            label="Latest PHQ-9"
            value={lastIntake?.phq9_score != null ? `${lastIntake.phq9_score} · ${lastIntake.phq9_severity || ''}` : '—'}
            tone={lastIntake?.phq9_score != null && lastIntake.phq9_score >= 15 ? 'red' : lastIntake?.phq9_score != null && lastIntake.phq9_score >= 10 ? 'amber' : 'gray'}
          />
          <QuickStat
            icon={<Heart className="w-4 h-4" />}
            label="Latest GAD-7"
            value={lastIntake?.gad7_score != null ? `${lastIntake.gad7_score} · ${lastIntake.gad7_severity || ''}` : '—'}
            tone={lastIntake?.gad7_score != null && lastIntake.gad7_score >= 15 ? 'red' : lastIntake?.gad7_score != null && lastIntake.gad7_score >= 10 ? 'amber' : 'gray'}
          />
          <QuickStat
            icon={<Phone className="w-4 h-4" />}
            label="Recent calls"
            value={`${data.call_logs?.length || 0} this period`}
            tone="gray"
          />
        </div>

        {/* Customizable section list */}
        {ALL_SECTIONS.map(section => (
          <CollapsibleSection
            key={section.key}
            section={section}
            open={openSections[section.key] ?? section.default_open}
            onToggle={() => toggleSection(section.key)}
            patientId={patientId}
            data={data}
          />
        ))}

        {/* Footer: customize hint */}
        <div className="text-xs text-gray-400 text-center pt-4">
          Tip: collapse sections you don't use — your layout saves automatically.
        </div>
      </div>
    </div>
  )
}

function StatusPill({ label, tone }: { label: string; tone: 'green' | 'amber' | 'red' | 'blue' | 'teal' | 'gray' }) {
  const tones: Record<typeof tone, string> = {
    green: 'bg-green-100 text-green-800 border-green-200',
    amber: 'bg-amber-100 text-amber-800 border-amber-200',
    red:   'bg-red-100 text-red-800 border-red-200',
    blue:  'bg-blue-100 text-blue-800 border-blue-200',
    teal:  'bg-teal-100 text-teal-800 border-teal-200',
    gray:  'bg-gray-100 text-gray-700 border-gray-200',
  }
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border ${tones[tone]}`}>{label}</span>
  )
}

function QuickStat({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone: 'teal' | 'amber' | 'red' | 'gray' }) {
  const valueTones: Record<typeof tone, string> = {
    teal:  'text-teal-700',
    amber: 'text-amber-700',
    red:   'text-red-700',
    gray:  'text-gray-900',
  }
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-3.5">
      <div className="flex items-center gap-1.5 text-xs text-gray-500 uppercase tracking-wide mb-1">
        {icon}
        <span>{label}</span>
      </div>
      <div className={`text-sm font-semibold ${valueTones[tone]}`}>{value}</div>
    </div>
  )
}

function CollapsibleSection(props: {
  section: { key: SectionKey; label: string; icon: any; default_open: boolean }
  open: boolean
  onToggle: () => void
  patientId: string
  data: PatientResp
}) {
  const { section, open, onToggle, patientId, data } = props
  const Icon = section.icon
  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full px-5 py-3.5 flex items-center justify-between hover:bg-gray-50 transition"
      >
        <div className="flex items-center gap-3">
          <Icon className="w-4 h-4 text-gray-500" />
          <span className="font-semibold text-gray-900">{section.label}</span>
        </div>
        {open ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
      </button>
      {open && (
        <div className="border-t border-gray-100 p-5">
          <SectionContent sectionKey={section.key} patientId={patientId} data={data} />
        </div>
      )}
    </div>
  )
}

function SectionContent({ sectionKey, patientId, data }: { sectionKey: SectionKey; patientId: string; data: PatientResp }) {
  switch (sectionKey) {
    case 'continuity':
      return <ContinuityBlock patientId={patientId} />
    case 'trajectory':
      return <TrajectoryBlock data={data} />
    case 'treatment_plan':
      return <TreatmentPlanCard patientId={patientId} />
    case 'biopsychosocial':
      return <BiopsychosocialIntakeCard patientId={patientId} />
    case 'safety_plan':
      return <StanleyBrownPlanEditor patientId={patientId} />
    case 'progress_notes':
      return <PatientProgressNotes patientId={patientId} />
    case 'assessments':
      return <AssessmentsCard patientId={patientId} />
    case 'mood':
      return <MoodLogsCard patientId={patientId} />
    case 'homework':
      return <HomeworkCard patientId={patientId} />
    case 'billing':
      return <BillingCard patientId={patientId} />
    case 'consents':
      return <ConsentsCard patientId={patientId} />
    case 'part2_consents':
      return <Part2ConsentsCard patientId={patientId} />
    case 'portal':
      return <PortalLinkCard patientId={patientId} />
    case 'communications':
      return <CommsBlock data={data} />
    case 'demographics':
      return <DemographicsBlock data={data} />
    case 'history':
      return <IntakeHistoryBlock data={data} />
    default:
      return <div className="text-sm text-gray-500">Coming soon.</div>
  }
}

function ContinuityBlock({ patientId }: { patientId: string }) {
  const [data, setData] = useState<{ summary?: string; generated_at?: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [regen, setRegen] = useState(false)

  async function load() {
    try {
      const r = await fetch(`/api/ehr/patients/${patientId}/continuity-summary`)
      if (r.ok) setData(await r.json())
      else setData({ summary: undefined })
    } finally { setLoading(false) }
  }
  useEffect(() => { load() /* eslint-disable-line */ }, [patientId])

  async function regenerate() {
    setRegen(true)
    try {
      const r = await fetch(`/api/ehr/patients/${patientId}/continuity-summary`, { method: 'POST' })
      if (r.ok) setData(await r.json())
    } finally { setRegen(false) }
  }

  if (loading) return <div className="text-sm text-gray-500">Loading continuity…</div>
  return (
    <div>
      {data?.summary ? (
        <>
          <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">{data.summary}</p>
          <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
            {data.generated_at && <span>Generated {new Date(data.generated_at).toLocaleString()}</span>}
            <button
              onClick={regenerate}
              disabled={regen}
              className="inline-flex items-center gap-1 text-teal-700 hover:text-teal-900 disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 ${regen ? 'animate-spin' : ''}`} />
              {regen ? 'Regenerating…' : 'Regenerate'}
            </button>
          </div>
        </>
      ) : (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-500">No continuity summary yet — generate one before next session.</p>
          <button
            onClick={regenerate}
            disabled={regen}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-teal-600 hover:bg-teal-700 text-white rounded-lg disabled:opacity-50"
          >
            <Sparkles className="w-3.5 h-3.5" />
            {regen ? 'Generating…' : 'Generate continuity'}
          </button>
        </div>
      )}
    </div>
  )
}

function TrajectoryBlock({ data }: { data: PatientResp }) {
  const intakes = data.intake_forms || []
  const phqs = intakes.filter(i => i.phq9_score != null).map(i => ({ x: i.completed_at, y: i.phq9_score! }))
  const gads = intakes.filter(i => i.gad7_score != null).map(i => ({ x: i.completed_at, y: i.gad7_score! }))

  if (phqs.length === 0 && gads.length === 0) {
    return <div className="text-sm text-gray-500">Trajectory will populate once assessments have been completed.</div>
  }

  // Simple sparkline-style summary (full chart can be a follow-up)
  return (
    <div className="space-y-3">
      {phqs.length > 0 && (
        <TrajectoryRow label="PHQ-9" series={phqs} max={27} dangerThreshold={15} />
      )}
      {gads.length > 0 && (
        <TrajectoryRow label="GAD-7" series={gads} max={21} dangerThreshold={15} />
      )}
      <div className="text-xs text-gray-400">Detailed chart coming soon.</div>
    </div>
  )
}

function TrajectoryRow({ label, series, max, dangerThreshold }: { label: string; series: { x: string | null; y: number }[]; max: number; dangerThreshold: number }) {
  const latest = series[series.length - 1]
  const earliest = series[0]
  const delta = series.length > 1 && latest && earliest ? latest.y - earliest.y : 0
  const trend = delta > 0 ? '↑' : delta < 0 ? '↓' : '→'
  const trendColor = delta > 0 ? 'text-red-600' : delta < 0 ? 'text-green-600' : 'text-gray-500'

  return (
    <div className="flex items-center justify-between gap-4 py-2 border-b border-gray-100 last:border-b-0">
      <div className="flex items-center gap-3">
        <span className="font-medium text-sm text-gray-900 w-16">{label}</span>
        <div className="flex items-end gap-0.5 h-6">
          {series.slice(-20).map((p, i) => {
            const heightPct = (p.y / max) * 100
            const isDanger = p.y >= dangerThreshold
            return (
              <div
                key={i}
                className={`w-1.5 rounded-sm ${isDanger ? 'bg-red-400' : 'bg-teal-400'}`}
                style={{ height: `${Math.max(8, heightPct)}%` }}
              />
            )
          })}
        </div>
      </div>
      <div className="text-sm">
        {latest && <span className={`font-semibold ${latest.y >= dangerThreshold ? 'text-red-700' : 'text-gray-900'}`}>{latest.y}</span>}
        {series.length > 1 && <span className={`ml-2 text-xs ${trendColor}`}>{trend} {Math.abs(delta)}</span>}
      </div>
    </div>
  )
}

function CommsBlock({ data }: { data: PatientResp }) {
  return (
    <div className="space-y-3">
      <div>
        <div className="text-xs text-gray-500 uppercase tracking-wide mb-2">Recent calls</div>
        {(data.call_logs?.length || 0) === 0 ? (
          <div className="text-sm text-gray-500">No calls on file.</div>
        ) : (
          <div className="space-y-2">
            {(data.call_logs || []).slice(0, 5).map(c => (
              <div key={c.id} className="text-sm border-l-2 border-teal-300 pl-3">
                <div className="flex items-center justify-between">
                  <div className="text-gray-700">{new Date(c.created_at).toLocaleString()}</div>
                  <div className="text-xs text-gray-500">{c.duration_seconds ? `${Math.round(c.duration_seconds / 60)}m` : ''}</div>
                </div>
                {c.summary && <div className="text-gray-600 text-xs mt-0.5 line-clamp-2">{c.summary}</div>}
                {c.crisis_detected && <div className="text-xs text-red-600 font-medium mt-0.5">⚠ Crisis flagged</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function DemographicsBlock({ data }: { data: PatientResp }) {
  const p = data.patient
  const [scannerOpen, setScannerOpen] = useState(false)
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 text-sm">
        <Field label="Phone" value={p.phone} icon={<Phone className="w-3 h-3" />} />
        <Field label="Email" value={p.email} icon={<Mail className="w-3 h-3" />} />
        <Field label="Pronouns" value={p.pronouns} />
        <Field label="DOB" value={p.date_of_birth ? new Date(p.date_of_birth).toLocaleDateString() : null} />
        <Field label="Address" value={p.address} />
        <Field label="Emergency contact" value={p.emergency_contact_name ? `${p.emergency_contact_name}${p.emergency_contact_phone ? ' · ' + p.emergency_contact_phone : ''}` : null} />
        <Field label="Referral source" value={p.referral_source} />
        <div className="py-1.5">
          <div className="text-xs text-gray-500 uppercase tracking-wide flex items-center gap-1">Insurance</div>
          <div className="text-gray-900 flex items-center gap-2">
            <span>{p.insurance_provider || <span className="text-gray-400">—</span>}</span>
            <button
              type="button"
              onClick={() => setScannerOpen(o => !o)}
              className="text-xs text-blue-600 hover:text-blue-800 underline"
              style={{ minHeight: 32 }}
            >
              {scannerOpen ? 'Close' : 'Update from card'}
            </button>
          </div>
        </div>
      </div>
      {scannerOpen && (
        <InsuranceCardScanner
          patientId={p.id}
          onSaved={() => {
            setScannerOpen(false)
            // Patient row updates land via the PATCH inside the component;
            // a hard reload picks them up without rewiring SWR keys.
            if (typeof window !== 'undefined') window.location.reload()
          }}
          onCancel={() => setScannerOpen(false)}
        />
      )}
    </div>
  )
}

function Field({ label, value, icon }: { label: string; value: string | null; icon?: React.ReactNode }) {
  return (
    <div className="py-1.5">
      <div className="text-xs text-gray-500 uppercase tracking-wide flex items-center gap-1">{icon}{label}</div>
      <div className="text-gray-900">{value || <span className="text-gray-400">—</span>}</div>
    </div>
  )
}

function IntakeHistoryBlock({ data }: { data: PatientResp }) {
  const forms = data.intake_forms || []
  if (forms.length === 0) return <div className="text-sm text-gray-500">No intake forms on file.</div>
  return (
    <div className="space-y-2">
      {forms.map(f => (
        <div key={f.id} className="text-sm border border-gray-200 rounded-lg px-3 py-2 flex items-center justify-between">
          <div>
            <div className="text-gray-900">{f.completed_at ? new Date(f.completed_at).toLocaleDateString() : 'In progress'}</div>
            <div className="text-xs text-gray-500">
              PHQ-9: {f.phq9_score ?? '—'} · GAD-7: {f.gad7_score ?? '—'}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
