// app/dashboard/ehr/reports/page.tsx
// Practice-owner view: hours seen, notes outstanding, no-show rate,
// goal progress, pending cosigns, new patients. One glance, whole
// practice health.

'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { BarChart3, Clock, FileText, Users, AlertTriangle, CheckCircle2, Target, PenLine as Signature } from 'lucide-react'

type Report = {
  hours_seen_7d: number
  sessions_completed_7d: number
  notes: {
    drafts_outstanding: number
    oldest_draft_days: number | null
    oldest_draft_title: string | null
    oldest_draft_id: string | null
    signed_30d: number
  }
  appointments: {
    total_30d: number
    completed_30d: number
    no_show_30d: number
    cancelled_30d: number
    no_show_rate_30d: number
    cancellation_rate_30d: number
  }
  new_patients_30d: { count: number; list: Array<{ id: string; name: string; since: string }> }
  goals: { active_plans: number; total_goals: number; plans_needing_review: number }
  pending_assessments: number
  pending_cosigns: { count: number; oldest_days: number | null }
}

export default function ReportsPage() {
  const [data, setData] = useState<Report | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/ehr/reports/productivity')
        if (res.ok) setData(await res.json())
      } finally { setLoading(false) }
    })()
  }, [])

  if (loading) return <div className="max-w-5xl mx-auto py-8 px-4 text-sm text-gray-500">Loading…</div>
  if (!data) return <div className="max-w-5xl mx-auto py-8 px-4 text-sm text-red-600">Could not load reports.</div>

  const draftUrgent = (data.notes.oldest_draft_days ?? 0) > 3

  return (
    <div className="max-w-6xl mx-auto py-8 px-4 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900 flex items-center gap-2">
          <BarChart3 className="w-6 h-6 text-teal-600" />
          Practice Reports
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          This week&apos;s hours, open documentation, no-show trends, and everything that needs your attention.
        </p>
      </div>

      {/* Top stat row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat icon={<Clock className="w-4 h-4" />} label="Hours seen · 7 days" value={data.hours_seen_7d.toString()} hint={`${data.sessions_completed_7d} sessions completed`} />
        <Stat
          icon={<FileText className="w-4 h-4" />}
          label="Drafts outstanding"
          value={data.notes.drafts_outstanding.toString()}
          hint={
            data.notes.oldest_draft_days != null
              ? `Oldest: ${data.notes.oldest_draft_days} day${data.notes.oldest_draft_days === 1 ? '' : 's'}`
              : 'All caught up'
          }
          accent={draftUrgent ? 'red' : data.notes.drafts_outstanding > 0 ? 'amber' : 'green'}
        />
        <Stat icon={<CheckCircle2 className="w-4 h-4" />} label="Signed · 30 days" value={data.notes.signed_30d.toString()} hint="notes signed or amended" />
        <Stat icon={<Users className="w-4 h-4" />} label="New patients · 30 days" value={data.new_patients_30d.count.toString()} hint="first contact" />
      </div>

      {/* Appointment metrics */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <h2 className="font-semibold text-gray-900 mb-3">Appointments · last 30 days</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Total" value={data.appointments.total_30d.toString()} />
          <Stat label="Completed" value={data.appointments.completed_30d.toString()} accent="green" />
          <Stat
            label="No-show rate"
            value={`${data.appointments.no_show_rate_30d}%`}
            hint={`${data.appointments.no_show_30d} sessions`}
            accent={data.appointments.no_show_rate_30d > 10 ? 'red' : data.appointments.no_show_rate_30d > 5 ? 'amber' : 'green'}
          />
          <Stat
            label="Cancellation rate"
            value={`${data.appointments.cancellation_rate_30d}%`}
            hint={`${data.appointments.cancelled_30d} sessions`}
            accent={data.appointments.cancellation_rate_30d > 15 ? 'red' : data.appointments.cancellation_rate_30d > 8 ? 'amber' : 'green'}
          />
        </div>
      </div>

      {/* Attention queue */}
      {(draftUrgent || data.pending_cosigns.count > 0 || data.goals.plans_needing_review > 0 || data.pending_assessments > 0) && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
          <h2 className="font-semibold text-amber-900 flex items-center gap-2 mb-3">
            <AlertTriangle className="w-4 h-4" />
            Attention needed
          </h2>
          <ul className="space-y-2 text-sm text-amber-900">
            {draftUrgent && data.notes.oldest_draft_id && (
              <li className="flex items-start gap-2">
                <FileText className="w-4 h-4 mt-0.5 shrink-0" />
                <span>
                  Oldest draft note is <strong>{data.notes.oldest_draft_days} days old</strong>:{' '}
                  <Link href={`/dashboard/ehr/notes/${data.notes.oldest_draft_id}`} className="underline hover:text-amber-950">
                    {data.notes.oldest_draft_title}
                  </Link>
                </span>
              </li>
            )}
            {data.pending_cosigns.count > 0 && (
              <li className="flex items-start gap-2">
                <Signature className="w-4 h-4 mt-0.5 shrink-0" />
                <span>
                  {data.pending_cosigns.count} note{data.pending_cosigns.count === 1 ? '' : 's'} awaiting supervisor co-sign
                  {data.pending_cosigns.oldest_days != null && ` (oldest ${data.pending_cosigns.oldest_days} days)`}.{' '}
                  <Link href="/dashboard/ehr/supervision" className="underline hover:text-amber-950">Review queue →</Link>
                </span>
              </li>
            )}
            {data.goals.plans_needing_review > 0 && (
              <li className="flex items-start gap-2">
                <Target className="w-4 h-4 mt-0.5 shrink-0" />
                <span>
                  {data.goals.plans_needing_review} treatment plan{data.goals.plans_needing_review === 1 ? '' : 's'} past their review date.
                </span>
              </li>
            )}
            {data.pending_assessments > 0 && (
              <li className="flex items-start gap-2">
                <BarChart3 className="w-4 h-4 mt-0.5 shrink-0" />
                <span>
                  {data.pending_assessments} assessment{data.pending_assessments === 1 ? '' : 's'} still awaiting patient response.
                </span>
              </li>
            )}
          </ul>
        </div>
      )}

      {/* Goals + new patients */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2 mb-3">
            <Target className="w-4 h-4 text-gray-500" />
            Active treatment plans
          </h2>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div><div className="text-2xl font-bold text-gray-900">{data.goals.active_plans}</div><div className="text-xs text-gray-500">active plans</div></div>
            <div><div className="text-2xl font-bold text-gray-900">{data.goals.total_goals}</div><div className="text-xs text-gray-500">total goals</div></div>
            <div><div className={`text-2xl font-bold ${data.goals.plans_needing_review > 0 ? 'text-amber-700' : 'text-gray-900'}`}>{data.goals.plans_needing_review}</div><div className="text-xs text-gray-500">need review</div></div>
          </div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2 mb-3">
            <Users className="w-4 h-4 text-gray-500" />
            New patients · last 30 days
          </h2>
          {data.new_patients_30d.list.length === 0 ? (
            <p className="text-sm text-gray-500">None.</p>
          ) : (
            <ul className="text-sm space-y-1">
              {data.new_patients_30d.list.map((p) => (
                <li key={p.id} className="flex items-center justify-between">
                  <Link href={`/dashboard/patients/${p.id}`} className="text-teal-700 hover:text-teal-900 truncate">{p.name}</Link>
                  <span className="text-xs text-gray-500">{new Date(p.since).toLocaleDateString()}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

function Stat({ icon, label, value, hint, accent }: {
  icon?: React.ReactNode
  label: string
  value: string
  hint?: string
  accent?: 'green' | 'amber' | 'red'
}) {
  const cls =
    accent === 'green' ? 'text-emerald-700'
    : accent === 'amber' ? 'text-amber-700'
    : accent === 'red'   ? 'text-red-700'
    : 'text-gray-900'
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3">
      <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-gray-500">
        {icon}{label}
      </div>
      <div className={`text-2xl font-bold mt-1 ${cls}`}>{value}</div>
      {hint && <div className="text-[11px] text-gray-500 mt-0.5">{hint}</div>}
    </div>
  )
}
