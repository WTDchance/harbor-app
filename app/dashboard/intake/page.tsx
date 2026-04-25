'use client'

// app/dashboard/intake/page.tsx
// Harbor - Intake Submissions Dashboard
// Expandable cards showing full patient intake details inline

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-browser'
import { Search, ChevronDown, ChevronUp, FileText, User, Phone, Mail, Calendar, AlertCircle, Shield, ClipboardList } from 'lucide-react'

const supabase = createClient()

// --- Types ---
type Severity = 'Minimal' | 'Mild' | 'Moderate' | 'Moderately Severe' | 'Severe'

type Submission = {
  id: string
  status: string
  patient_name: string | null
  patient_phone: string | null
  patient_email: string | null
  patient_dob: string | null
  phq9_score: number | null
  phq9_severity: Severity | null
  gad7_score: number | null
  gad7_severity: Severity | null
  completed_at: string | null
  created_at: string
}

type Demographics = {
  first_name?: string
  last_name?: string
  date_of_birth?: string
  phone?: string
  email?: string
  address?: string
  city?: string
  state?: string
  zip?: string
  emergency_contact_name?: string
  emergency_contact_phone?: string
  emergency_contact_relationship?: string
  preferred_pronouns?: string
  referral_source?: string
}

type InsuranceInfo = {
  has_insurance?: boolean | null
  insurance_provider?: string
  policy_number?: string
  group_number?: string
  subscriber_name?: string
  subscriber_dob?: string
  relationship_to_subscriber?: string
}

type DocumentSignature = {
  id: string
  signed_name: string | null
  signed_at: string
  signature_image: string | null
  additional_fields: Record<string, unknown> | null
  intake_documents: { id: string; name: string; requires_signature: boolean } | null
}

type SubmissionDetail = {
  id: string
  status: string
  patient_name: string | null
  patient_phone: string | null
  patient_email: string | null
  patient_dob: string | null
  patient_address: string | null
  demographics: Demographics | null
  insurance: InsuranceInfo | null
  signature_data: string | null
  signed_name: string | null
  phq9_answers: number[] | null
  phq9_score: number | null
  phq9_severity: string | null
  gad7_answers: number[] | null
  gad7_score: number | null
  gad7_severity: string | null
  additional_notes: string | null
  completed_at: string | null
  created_at: string
  intake_document_signatures: DocumentSignature[]
}

// --- Constants ---
const PHQ9_QUESTIONS = [
  'Little interest or pleasure in doing things',
  'Feeling down, depressed, or hopeless',
  'Trouble falling/staying asleep, or sleeping too much',
  'Feeling tired or having little energy',
  'Poor appetite or overeating',
  'Feeling bad about yourself, or that you are a failure',
  'Trouble concentrating on things',
  'Moving/speaking slowly or being fidgety/restless',
  'Thoughts that you would be better off dead, or of hurting yourself',
]

const GAD7_QUESTIONS = [
  'Feeling nervous, anxious, or on edge',
  'Not being able to stop or control worrying',
  'Worrying too much about different things',
  'Trouble relaxing',
  'Being so restless that it\'s hard to sit still',
  'Becoming easily annoyed or irritable',
  'Feeling afraid, as if something awful might happen',
]

const ANSWER_LABELS = ['Not at all', 'Several days', 'More than half the days', 'Nearly every day']

const REFERRAL_LABELS: Record<string, string> = {
  doctor_referral: 'Doctor / Medical Referral',
  insurance: 'Insurance Provider',
  friend_family: 'Friend or Family',
  online_search: 'Online Search',
  social_media: 'Social Media',
  psychology_today: 'Psychology Today',
  other: 'Other',
}

// --- Helpers ---
async function apiFetch(url: string, init?: RequestInit) {
  return fetch(url, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
}

const SEVERITY_COLORS: Record<string, string> = {
  Minimal: 'bg-green-100 text-green-800',
  Mild: 'bg-yellow-100 text-yellow-800',
  Moderate: 'bg-orange-100 text-orange-800',
  'Moderately Severe': 'bg-red-100 text-red-800',
  Severe: 'bg-red-200 text-red-900',
}

function formatDate(iso: string | null) {
  if (!iso) return '-'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatDateTime(iso: string | null) {
  if (!iso) return '-'
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
}

// --- Components ---
function SeverityBadge({ score, severity, label }: { score: number | null; severity: string | null; label: string }) {
  if (score === null || severity === null) return <span className="text-gray-400 text-xs">-</span>
  return (
    <div className="flex items-center gap-1.5">
      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${SEVERITY_COLORS[severity] ?? 'bg-gray-100 text-gray-700'}`}>
        {severity}
      </span>
      <span className="text-xs text-gray-500">{label}: {score}</span>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string | null }) {
  if (!value) return null
  return (
    <div className="flex flex-col sm:flex-row sm:items-baseline gap-0.5 sm:gap-3 py-2 border-b border-gray-50 last:border-0">
      <span className="text-xs font-medium text-gray-500 sm:w-36 shrink-0">{label}</span>
      <span className="text-sm text-gray-900">{value}</span>
    </div>
  )
}

function ScreeningSection({ title, score, severity, answers, questions, maxScore }: {
  title: string; score: number | null; severity: string | null; answers: number[] | null; questions: string[]; maxScore: number
}) {
  const [expanded, setExpanded] = useState(false)
  if (score === null) return null
  return (
    <div className="border border-gray-100 rounded-lg overflow-hidden">
      <button onClick={(e) => { e.stopPropagation(); setExpanded(!expanded) }}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 transition-colors">
        <div className="flex items-center gap-3">
          <h4 className="text-sm font-medium text-gray-700">{title}</h4>
          {severity && (
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${SEVERITY_COLORS[severity] ?? 'bg-gray-100 text-gray-700'}`}>
              {severity} | {score}/{maxScore}
            </span>
          )}
        </div>
        {answers && answers.length > 0 && (
          <span className="text-gray-400 text-xs">{expanded ? 'Hide' : 'Show'} answers</span>
        )}
      </button>
      {expanded && answers && answers.length > 0 && (
        <div className="border-t border-gray-100 divide-y divide-gray-50">
          {questions.map((q, i) => {
            const ans = answers[i] ?? 0
            return (
              <div key={i} className="flex items-start gap-3 px-4 py-2.5">
                <span className="text-xs text-gray-400 w-4 shrink-0 mt-0.5">{i + 1}.</span>
                <div className="flex-1">
                  <p className="text-xs text-gray-600">{q}</p>
                  <p className="text-xs mt-0.5">
                    <span className={`font-medium ${ans === 0 ? 'text-green-600' : ans === 1 ? 'text-yellow-600' : ans === 2 ? 'text-orange-600' : 'text-red-600'}`}>
                      {ANSWER_LABELS[ans] ?? ans}
                    </span>
                    <span className="text-gray-400 ml-1">({ans})</span>
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function ExpandedDetail({ submissionId }: { submissionId: string }) {
  const [detail, setDetail] = useState<SubmissionDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    (async () => {
      setLoading(true)
      try {
        const res = await apiFetch(`/api/intake/submissions/${submissionId}`)
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? 'Failed to load')
        setDetail(json.submission)
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to load details')
      } finally {
        setLoading(false)
      }
    })()
  }, [submissionId])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="w-6 h-6 border-3 border-teal-200 border-t-teal-600 rounded-full animate-spin" />
      </div>
    )
  }

  if (error || !detail) {
    return <p className="text-sm text-red-500 py-4 text-center">{error ?? 'Failed to load details'}</p>
  }

  const demo = detail.demographics
  const ins = detail.insurance
  const sigs = detail.intake_document_signatures ?? []

  return (
    <div className="border-t border-gray-100 px-5 pb-5 pt-4 space-y-4">
      {/* Patient Info */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <User className="w-4 h-4 text-teal-600" />
          <h3 className="text-sm font-semibold text-gray-800">Patient Information</h3>
        </div>
        <div className="bg-gray-50 rounded-lg p-3">
          <InfoRow label="Full Name" value={detail.patient_name} />
          <InfoRow label="Phone" value={demo?.phone || detail.patient_phone} />
          <InfoRow label="Email" value={demo?.email || detail.patient_email} />
          <InfoRow label="Date of Birth" value={demo?.date_of_birth ? formatDate(demo.date_of_birth) : detail.patient_dob ? formatDate(detail.patient_dob) : null} />
          <InfoRow label="Pronouns" value={demo?.preferred_pronouns || null} />
          <InfoRow label="Address" value={
            demo ? [demo.address, demo.city, demo.state, demo.zip].filter(Boolean).join(', ') || null : detail.patient_address
          } />
          <InfoRow label="Referral" value={demo?.referral_source ? (REFERRAL_LABELS[demo.referral_source] ?? demo.referral_source) : null} />
        </div>
      </div>

      {/* Emergency Contact */}
      {demo && (demo.emergency_contact_name || demo.emergency_contact_phone) && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Phone className="w-4 h-4 text-teal-600" />
            <h3 className="text-sm font-semibold text-gray-800">Emergency Contact</h3>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <InfoRow label="Name" value={demo.emergency_contact_name || null} />
            <InfoRow label="Phone" value={demo.emergency_contact_phone || null} />
            <InfoRow label="Relationship" value={demo.emergency_contact_relationship || null} />
          </div>
        </div>
      )}

      {/* Insurance */}
      {ins && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Shield className="w-4 h-4 text-teal-600" />
            <h3 className="text-sm font-semibold text-gray-800">Insurance</h3>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            {ins.has_insurance === false ? (
              <p className="text-sm text-gray-600">Self-pay / No insurance</p>
            ) : (
              <>
                <InfoRow label="Provider" value={ins.insurance_provider || null} />
                <InfoRow label="Policy/Member ID" value={ins.policy_number || null} />
                <InfoRow label="Group Number" value={ins.group_number || null} />
                <InfoRow label="Subscriber" value={ins.subscriber_name || null} />
                <InfoRow label="Subscriber DOB" value={ins.subscriber_dob ? formatDate(ins.subscriber_dob) : null} />
                <InfoRow label="Relationship" value={ins.relationship_to_subscriber || null} />
              </>
            )}
          </div>
        </div>
      )}

      {/* Screening Results */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <ClipboardList className="w-4 h-4 text-teal-600" />
          <h3 className="text-sm font-semibold text-gray-800">Screening Results</h3>
        </div>
        <div className="space-y-2">
          <ScreeningSection title="PHQ-9 Depression" score={detail.phq9_score} severity={detail.phq9_severity} answers={detail.phq9_answers} questions={PHQ9_QUESTIONS} maxScore={27} />
          <ScreeningSection title="GAD-7 Anxiety" score={detail.gad7_score} severity={detail.gad7_severity} answers={detail.gad7_answers} questions={GAD7_QUESTIONS} maxScore={21} />
        </div>
      </div>

      {/* Additional Notes */}
      {detail.additional_notes && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <FileText className="w-4 h-4 text-teal-600" />
            <h3 className="text-sm font-semibold text-gray-800">Additional Notes</h3>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{detail.additional_notes}</p>
          </div>
        </div>
      )}

      {/* Signed Documents */}
      {sigs.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <FileText className="w-4 h-4 text-teal-600" />
            <h3 className="text-sm font-semibold text-gray-800">Signed Documents ({sigs.length})</h3>
          </div>
          <div className="space-y-2">
            {sigs.map((sig) => (
              <div key={sig.id} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg border border-gray-100">
                <div className="text-green-500 mt-0.5 text-sm">&#10003;</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900">{sig.intake_documents?.name ?? 'Document'}</p>
                  {sig.signed_name && <p className="text-xs text-gray-500 mt-0.5">Signed as: {sig.signed_name}</p>}
                  <p className="text-xs text-gray-400 mt-0.5">{formatDateTime(sig.signed_at)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Consent Signature */}
      {detail.signed_name && (
        <div className="bg-gray-50 rounded-lg p-3">
          <p className="text-xs text-gray-500">Consent signed as: <span className="font-medium text-gray-700">{detail.signed_name}</span></p>
        </div>
      )}

      {/* View Full Detail link */}
      <div className="pt-2 flex items-center gap-3">
        <Link
          href={`/dashboard/intake/${detail.id}`}
          className="inline-flex items-center gap-2 px-4 py-2 bg-teal-50 text-teal-700 rounded-lg text-sm font-medium hover:bg-teal-100 transition-colors"
          onClick={(e) => e.stopPropagation()}
        >
          <FileText className="w-4 h-4" />
          View Full Detail Page
        </Link>
      </div>
    </div>
  )
}

// --- Submission Card ---
function SubmissionCard({ sub, expanded, onToggle }: { sub: Submission; expanded: boolean; onToggle: () => void }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
      <div onClick={onToggle} className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-gray-50/50 transition-colors">
        <div className="flex items-center gap-4 flex-1 min-w-0">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="font-medium text-gray-900 truncate">{sub.patient_name ?? 'Unnamed Patient'}</p>
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                sub.status === 'completed' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
              }`}>
                {sub.status.charAt(0).toUpperCase() + sub.status.slice(1)}
              </span>
            </div>
            <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
              {sub.patient_phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{sub.patient_phone}</span>}
              {sub.patient_email && <span className="flex items-center gap-1"><Mail className="w-3 h-3" />{sub.patient_email}</span>}
              {sub.completed_at && <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{formatDate(sub.completed_at)}</span>}
            </div>
          </div>
          <div className="flex items-center gap-4 shrink-0">
            <SeverityBadge score={sub.phq9_score} severity={sub.phq9_severity} label="PHQ-9" />
            <SeverityBadge score={sub.gad7_score} severity={sub.gad7_severity} label="GAD-7" />
          </div>
        </div>
        <div className="ml-3 text-gray-400">
          {expanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
        </div>
      </div>
      {expanded && <ExpandedDetail submissionId={sub.id} />}
    </div>
  )
}

// --- Main Page ---
export default function IntakeDashboardPage() {
  const router = useRouter()
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'completed' | 'pending' | 'all'>('all')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const limit = 25

  const fetchSubmissions = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      params.set('status', statusFilter)
      params.set('page', String(page))
      params.set('limit', String(limit))
      if (search) params.set('search', search)
      if (fromDate) params.set('from', fromDate)
      if (toDate) params.set('to', toDate)
      const res = await apiFetch(`/api/intake/submissions?${params.toString()}`)
      if (res.status === 401) { router.push('/login'); return }
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to load')
      setSubmissions(json.submissions ?? [])
      setTotal(json.pagination?.total ?? 0)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load intake submissions')
    } finally {
      setLoading(false)
    }
  }, [statusFilter, page, search, fromDate, toDate, router])

  useEffect(() => { fetchSubmissions() }, [fetchSubmissions])
  useEffect(() => { setPage(1) }, [statusFilter, search, fromDate, toDate])

  // Auto-refresh every 2 minutes
  useEffect(() => {
    const interval = setInterval(fetchSubmissions, 120000)
    return () => clearInterval(interval)
  }, [fetchSubmissions])

  const completed = submissions.filter((s) => s.status === 'completed')
  const avgPhq9 = completed.length > 0 && completed.some((s) => s.phq9_score !== null)
    ? Math.round(completed.reduce((sum, s) => sum + (s.phq9_score ?? 0), 0) / completed.filter((s) => s.phq9_score !== null).length)
    : null
  const elevated = completed.filter(
    (s) => (s.phq9_score !== null && s.phq9_score >= 10) || (s.gad7_score !== null && s.gad7_score >= 10)
  ).length
  const totalPages = Math.ceil(total / limit)

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Intake Submissions</h1>
            <p className="text-sm text-gray-500 mt-0.5">Patient intake forms and clinical screening results</p>
          </div>
          <div className="flex items-center gap-3">
            <a href="/dashboard/intake/documents" className="px-3 py-1.5 text-sm text-teal-600 border border-teal-200 rounded-lg hover:bg-teal-50 transition-colors font-medium">
              Manage Documents
            </a>
            <a href="/dashboard/appointments" className="text-sm text-gray-500 hover:text-teal-600 transition-colors">Appointments</a>
            <a href="/dashboard/settings" className="text-sm text-gray-500 hover:text-teal-600 transition-colors">Settings</a>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Submitted', value: total, sub: 'all time', color: 'text-gray-900' },
            { label: 'On This Page', value: submissions.length, sub: `of ${total}`, color: 'text-teal-600' },
            { label: 'Avg PHQ-9', value: avgPhq9 !== null ? avgPhq9 : '-', sub: 'depression screen', color: avgPhq9 !== null && avgPhq9 >= 10 ? 'text-orange-600' : 'text-gray-900' },
            { label: 'Elevated Scores', value: elevated, sub: 'PHQ-9 >=10 or GAD-7 >=10', color: elevated > 0 ? 'text-red-600' : 'text-green-600' },
          ].map((s) => (
            <div key={s.label} className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm">
              <p className="text-sm text-gray-500">{s.label}</p>
              <p className={`text-3xl font-bold mt-1 ${s.color}`}>{s.value}</p>
              <p className="text-xs text-gray-400 mt-0.5">{s.sub}</p>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
          <div className="flex-1 min-w-48 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by patient name..."
              className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>
          <div className="flex items-center gap-2">
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-500" />
            <span className="text-gray-400 text-sm">to</span>
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-500" />
          </div>
          <div className="flex gap-2">
            {(['completed', 'pending', 'all'] as const).map((s) => (
              <button key={s} onClick={() => setStatusFilter(s)}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  statusFilter === s ? 'bg-teal-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Submission Cards */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-4 border-teal-200 border-t-teal-600 rounded-full animate-spin" />
          </div>
        ) : error ? (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-8 text-center">
            <AlertCircle className="w-8 h-8 text-red-400 mx-auto mb-3" />
            <p className="text-red-600 mb-3">{error}</p>
            <button onClick={fetchSubmissions} className="px-4 py-2 text-sm bg-teal-600 text-white rounded-lg hover:bg-teal-700">Retry</button>
          </div>
        ) : submissions.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-12 text-center text-gray-400">
            <ClipboardList className="w-10 h-10 mx-auto mb-3 text-gray-300" />
            <p className="font-medium text-gray-600">No intake submissions found</p>
            <p className="text-sm mt-1">
              {search || fromDate || toDate
                ? 'Try adjusting your filters'
                : statusFilter === 'completed'
                ? 'Completed submissions will appear here once patients fill out their intake forms'
                : 'No submissions yet'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {submissions.map((sub) => (
              <SubmissionCard
                key={sub.id}
                sub={sub}
                expanded={expandedId === sub.id}
                onToggle={() => setExpandedId(expandedId === sub.id ? null : sub.id)}
              />
            ))}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-3">
            <p className="text-sm text-gray-500">
              Showing {(page - 1) * limit + 1}-{Math.min(page * limit, total)} of {total}
            </p>
            <div className="flex gap-2">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
                className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                Prev
              </button>
              <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
