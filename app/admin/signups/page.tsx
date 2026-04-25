'use client'

import { useEffect, useState } from 'react'
import {
  CheckCircle2,
  AlertTriangle,
  Clock,
  RefreshCw,
  Power,
  PowerOff,
  Phone,
  Mail,
  Loader2,
} from 'lucide-react'

interface PracticeRow {
  id: string
  name: string
  therapist_name: string | null
  notification_email: string | null
  phone_number: string | null
  status: string | null
  subscription_status: string | null
  founding_member: boolean | null
  vapi_assistant_id: string | null
  vapi_phone_number_id: string | null
  twilio_phone_sid: string | null
  stripe_customer_id: string | null
  provisioning_error: string | null
  provisioning_attempts: number | null
  provisioned_at: string | null
  created_at: string
}

interface ApiResponse {
  signups_enabled: boolean
  signups_toggled_at: string | null
  counts: { total: number; active: number; pending: number; failed: number; founding: number }
  practices: PracticeRow[]
}

export default function AdminSignupsPage() {
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [toggling, setToggling] = useState(false)
  const [retryingId, setRetryingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    try {
      const res = await fetch('/api/admin/signups', { cache: 'no-store' })
      const body = await res.json()
      if (!res.ok) {
        setError(body?.error || 'Failed to load')
        return
      }
      setData(body)
      setError(null)
    } catch (e: any) {
      setError(e?.message || 'Network error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    const id = setInterval(load, 10000)
    return () => clearInterval(id)
  }, [])

  const toggleSignups = async () => {
    if (!data) return
    const next = !data.signups_enabled
    const confirmMsg = next
      ? 'Re-enable new signups? New practices will be able to check out again.'
      : 'Pause new signups? The /signup page will show a maintenance message until you re-enable.'
    if (!window.confirm(confirmMsg)) return

    setToggling(true)
    try {
      const res = await fetch('/api/admin/signups/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        alert('Toggle failed: ' + (body?.error || res.status))
      } else {
        await load()
      }
    } finally {
      setToggling(false)
    }
  }

  const retry = async (practiceId: string) => {
    if (!window.confirm('Retry provisioning for this practice? This will buy a Twilio number + create a Vapi assistant if they are missing.')) return
    setRetryingId(practiceId)
    try {
      const res = await fetch(`/api/admin/signups/${practiceId}/retry`, { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        alert('Retry failed: ' + (body?.error || body?.message || res.status))
      } else {
        alert('Retry succeeded. Phone: ' + (body?.phone_number || 'n/a'))
        await load()
      }
    } finally {
      setRetryingId(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40">
        <Loader2 className="w-6 h-6 text-teal-600 animate-spin" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4">
        Failed to load signups: {error || 'no data'}
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Signup Monitor</h1>
          <p className="text-sm text-gray-500 mt-1">
            Live view of incoming practices — auto-refreshes every 10 seconds.
          </p>
        </div>
        <button
          onClick={toggleSignups}
          disabled={toggling}
          className={
            data.signups_enabled
              ? 'flex items-center gap-2 bg-white border border-gray-300 hover:border-red-400 hover:bg-red-50 text-gray-700 hover:text-red-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50'
              : 'flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50'
          }
        >
          {toggling ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : data.signups_enabled ? (
            <Power className="w-4 h-4" />
          ) : (
            <PowerOff className="w-4 h-4" />
          )}
          {data.signups_enabled ? 'Pause signups' : 'Signups PAUSED — resume'}
        </button>
      </div>

      {/* Counters */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        <StatCard label="Total" value={data.counts.total} color="gray" />
        <StatCard label="Active" value={data.counts.active} color="green" />
        <StatCard label="Pending" value={data.counts.pending} color="yellow" />
        <StatCard label="Failed" value={data.counts.failed} color="red" />
        <StatCard label="Founding" value={data.counts.founding} color="teal" />
      </div>

      {!data.signups_enabled && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
          <div className="text-sm">
            <p className="font-semibold text-red-700">Signups are paused</p>
            <p className="text-red-600 mt-0.5">
              The /signup page is showing a maintenance message. Click the Resume button above to
              turn signups back on.
            </p>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="-mx-4 md:mx-0 overflow-x-auto">
          <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left text-xs font-medium text-gray-500 uppercase px-5 py-3">Practice</th>
              <th className="text-left text-xs font-medium text-gray-500 uppercase px-5 py-3">Contact</th>
              <th className="text-left text-xs font-medium text-gray-500 uppercase px-5 py-3">Status</th>
              <th className="text-left text-xs font-medium text-gray-500 uppercase px-5 py-3">Provisioning</th>
              <th className="text-left text-xs font-medium text-gray-500 uppercase px-5 py-3">Age</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {data.practices.map((p) => (
              <PracticeRowComponent
                key={p.id}
                row={p}
                onRetry={() => retry(p.id)}
                retrying={retryingId === p.id}
              />
            ))}
            {data.practices.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-12 text-center text-gray-400">
                  No signups yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  )
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  const colors: Record<string, string> = {
    gray: 'bg-white border-gray-200 text-gray-900',
    green: 'bg-green-50 border-green-200 text-green-700',
    yellow: 'bg-yellow-50 border-yellow-200 text-yellow-700',
    red: 'bg-red-50 border-red-200 text-red-700',
    teal: 'bg-teal-50 border-teal-200 text-teal-700',
  }
  return (
    <div className={`rounded-xl border p-4 ${colors[color]}`}>
      <p className="text-xs uppercase font-medium opacity-70">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
    </div>
  )
}

function PracticeRowComponent({
  row,
  onRetry,
  retrying,
}: {
  row: PracticeRow
  onRetry: () => void
  retrying: boolean
}) {
  const isFailed = row.status === 'provisioning_failed' || !!row.provisioning_error
  const isActive = row.status === 'active' && !!row.phone_number
  const isPending = row.status === 'pending_payment'

  return (
    <tr className="hover:bg-gray-50 align-top">
      <td className="px-5 py-4">
        <p className="font-medium text-gray-900">{row.name || '(no name)'}</p>
        <p className="text-sm text-gray-500">{row.therapist_name || '—'}</p>
        {row.founding_member && (
          <span className="inline-flex items-center mt-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
            Founding
          </span>
        )}
      </td>
      <td className="px-5 py-4">
        <div className="flex flex-col gap-1 text-sm text-gray-500">
          {row.notification_email && (
            <div className="flex items-center gap-1.5">
              <Mail className="w-3.5 h-3.5" /> {row.notification_email}
            </div>
          )}
          {row.phone_number && (
            <div className="flex items-center gap-1.5 text-gray-700">
              <Phone className="w-3.5 h-3.5" /> {row.phone_number}
            </div>
          )}
        </div>
      </td>
      <td className="px-5 py-4">
        {isActive ? (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
            <CheckCircle2 className="w-3 h-3" /> Active
          </span>
        ) : isFailed ? (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
            <AlertTriangle className="w-3 h-3" /> Failed
          </span>
        ) : isPending ? (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700">
            <Clock className="w-3 h-3" /> Pending payment
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
            {row.status || 'unknown'}
          </span>
        )}
        <p className="text-xs text-gray-400 mt-1">sub: {row.subscription_status || '—'}</p>
      </td>
      <td className="px-5 py-4 text-xs text-gray-600 max-w-xs">
        <div className="space-y-0.5">
          <div>
            Vapi: {row.vapi_assistant_id ? (
              <code className="bg-gray-100 px-1.5 py-0.5 rounded">{row.vapi_assistant_id.slice(0, 8)}…</code>
            ) : (
              <span className="text-gray-400">none</span>
            )}
          </div>
          <div>
            Twilio SID: {row.twilio_phone_sid ? (
              <code className="bg-gray-100 px-1.5 py-0.5 rounded">{row.twilio_phone_sid.slice(0, 8)}…</code>
            ) : (
              <span className="text-gray-400">none</span>
            )}
          </div>
          {row.provisioning_attempts && row.provisioning_attempts > 0 ? (
            <div className="text-gray-500">Attempts: {row.provisioning_attempts}</div>
          ) : null}
          {row.provisioning_error && (
            <div className="text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1 mt-1 break-words">
              {row.provisioning_error}
            </div>
          )}
        </div>
      </td>
      <td className="px-5 py-4 text-xs text-gray-500 whitespace-nowrap">
        {formatAge(row.created_at)}
      </td>
      <td className="px-5 py-4 text-right whitespace-nowrap">
        {(isFailed || !isActive) && row.status !== 'pending_payment' && (
          <button
            onClick={onRetry}
            disabled={retrying}
            className="inline-flex items-center gap-1.5 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
          >
            {retrying ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            Retry
          </button>
        )}
      </td>
    </tr>
  )
}

function formatAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const min = Math.floor(ms / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const d = Math.floor(hr / 24)
  return `${d}d ago`
}

