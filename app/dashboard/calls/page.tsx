'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Search, Phone, Clock, ChevronDown, ChevronUp, AlertCircle, User } from 'lucide-react'
import { createClient } from '@/lib/supabase-browser'

interface CallLog {
  id: string
  patient_phone: string
  duration_seconds: number
  summary: string | null
  transcript: string | null
  created_at: string
  crisis_detected?: boolean
  caller_name?: string | null
  call_type?: string | null
  insurance_mentioned?: string | null
  session_type?: string | null
  preferred_times?: string | null
  reason_for_calling?: string | null
  patient_id?: string | null
  intake_screenings?: Array<{
    phq2_score?: number
    gad2_score?: number
  }>
}

function formatDuration(seconds: number) {
  if (!seconds) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function formatDate(iso: string) {
  const date = new Date(iso)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const mins = Math.floor(diff / 60000)

  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`

  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`

  const days = Math.floor(hrs / 24)
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days}d ago`

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function getScreeningBadgeColor(score?: number): string {
  if (score === undefined) return 'bg-gray-100 text-gray-700'
  if (score < 3) return 'bg-green-100 text-green-700'
  if (score < 5) return 'bg-yellow-100 text-yellow-700'
  return 'bg-red-100 text-red-700'
}

const CALL_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  new_patient: { label: 'New Patient', color: 'bg-purple-100 text-purple-700' },
  existing_patient: { label: 'Existing Patient', color: 'bg-blue-100 text-blue-700' },
  scheduling: { label: 'Scheduling', color: 'bg-teal-100 text-teal-700' },
  cancellation: { label: 'Cancellation', color: 'bg-orange-100 text-orange-700' },
  question: { label: 'Question', color: 'bg-gray-100 text-gray-700' },
  crisis: { label: 'Crisis', color: 'bg-red-100 text-red-700' },
  other: { label: 'Other', color: 'bg-gray-100 text-gray-600' },
}

function CallCard({ call }: { call: CallLog }) {
  const [expanded, setExpanded] = useState(false)
  const phq2Score = call.intake_screenings?.[0]?.phq2_score
  const gad2Score = call.intake_screenings?.[0]?.gad2_score
  const callTypeInfo = call.call_type ? CALL_TYPE_LABELS[call.call_type] : null

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div
        className="flex items-start gap-4 p-5 cursor-pointer hover:bg-gray-50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="w-10 h-10 bg-teal-100 rounded-full flex items-center justify-center flex-shrink-0">
          <Phone className="w-4 h-4 text-teal-600" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-semibold text-gray-900">
                {call.caller_name || call.patient_phone}
              </p>
              {call.caller_name && (
                <span className="text-sm text-gray-400">{call.patient_phone}</span>
              )}
              {callTypeInfo && (
                <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold ${callTypeInfo.color}`}>
                  {callTypeInfo.label}
                </span>
              )}
              {call.crisis_detected && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700">
                  <AlertCircle className="w-3 h-3" /> Crisis
                </span>
              )}
              {phq2Score !== undefined && (
                <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold ${getScreeningBadgeColor(phq2Score)}`}>
                  PHQ-2: {phq2Score}
                </span>
              )}
              {gad2Score !== undefined && (
                <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold ${getScreeningBadgeColor(gad2Score)}`}>
                  GAD-2: {gad2Score}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 text-sm text-gray-400 flex-shrink-0">
              <span className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                {formatDuration(call.duration_seconds)}
              </span>
              <span>{formatDate(call.created_at)}</span>
              {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </div>
          </div>
          {call.summary && (
            <p className="text-sm text-gray-600 mt-1 line-clamp-2">{call.summary}</p>
          )}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-gray-100 px-5 pb-5 pt-4 space-y-4">
            {/* View Patient link */}
            {call.patient_id && (
              <Link
                href={`/dashboard/patients/${call.patient_id}`}
                className="inline-flex items-center gap-2 px-4 py-2 bg-teal-50 text-teal-700 rounded-lg text-sm font-medium hover:bg-teal-100 transition-colors"
                onClick={(e) => e.stopPropagation()}
              >
                <User className="w-4 h-4" />
                View Patient Profile
              </Link>
            )}
          {/* Extracted details grid */}
          {(call.insurance_mentioned || call.session_type || call.preferred_times || call.reason_for_calling) && (
            <div className="grid grid-cols-2 gap-3">
              {call.reason_for_calling && (
                <div className="bg-purple-50 rounded-lg p-3">
                  <p className="text-xs font-semibold text-purple-600 uppercase tracking-wide mb-0.5">Reason</p>
                  <p className="text-sm text-gray-800">{call.reason_for_calling}</p>
                </div>
              )}
              {call.insurance_mentioned && (
                <div className="bg-blue-50 rounded-lg p-3">
                  <p className="text-xs font-semibold text-blue-600 uppercase tracking-wide mb-0.5">Insurance</p>
                  <p className="text-sm text-gray-800">{call.insurance_mentioned}</p>
                </div>
              )}
              {call.session_type && (
                <div className="bg-teal-50 rounded-lg p-3">
                  <p className="text-xs font-semibold text-teal-600 uppercase tracking-wide mb-0.5">Session Type</p>
                  <p className="text-sm text-gray-800 capitalize">{call.session_type}</p>
                </div>
              )}
              {call.preferred_times && (
                <div className="bg-amber-50 rounded-lg p-3">
                  <p className="text-xs font-semibold text-amber-600 uppercase tracking-wide mb-0.5">Preferred Times</p>
                  <p className="text-sm text-gray-800">{call.preferred_times}</p>
                </div>
              )}
            </div>
          )}
          {call.summary && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">AI Summary</p>
              <p className="text-sm text-gray-700 bg-teal-50 rounded-lg p-3">{call.summary}</p>
            </div>
          )}
          {call.transcript && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Transcript</p>
              <pre className="text-xs text-gray-600 bg-gray-50 rounded-lg p-3 whitespace-pre-wrap font-sans max-h-64 overflow-y-auto">
                {call.transcript}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function CallsPage() {
  const [calls, setCalls] = useState<CallLog[]>([])
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'crisis' | 'new_patient'>('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const supabase = createClient()

  useEffect(() => {
    const fetchCalls = async () => {
      try {
        // Use server-side API route that bypasses RLS
        const { data: { session } } = await supabase.auth.getSession()
        if (!session?.access_token) {
          console.error('[Calls] No session')
          setLoading(false)
          return
        }

        const res = await fetch('/api/dashboard/calls', {
          headers: {
            'Content-Type': 'application/json',
          },
        })

        if (!res.ok) {
          throw new Error('Failed to fetch calls: ' + res.status)
        }

        const result = await res.json()
        setCalls(result.calls || [])
      } catch (err) {
        console.error('[Calls] Error fetching calls:', err)
        setError('Something went wrong loading calls')
      } finally {
        setLoading(false)
      }
    }

    fetchCalls()

    // Auto-refresh call logs every 2 minutes
    const refreshInterval = setInterval(fetchCalls, 120000)
    return () => clearInterval(refreshInterval)
    }, [supabase])

  const newPatientCount = calls.filter(c => c.call_type === 'new_patient').length

  const filtered = calls
    .filter(c => {
      if (filter === 'crisis') return c.crisis_detected
      if (filter === 'new_patient') return c.call_type === 'new_patient'
      return true
    })
    .filter(c =>
      c.patient_phone?.includes(search) ||
      c.caller_name?.toLowerCase().includes(search.toLowerCase()) ||
      c.summary?.toLowerCase().includes(search.toLowerCase())
    )

  const totalDuration = calls.reduce((sum, c) => sum + (c.duration_seconds || 0), 0)
  const avgDuration = calls.length ? Math.round(totalDuration / calls.length) : 0
  const crisisCount = calls.filter(c => c.crisis_detected).length

  return (
    <div className="bg-gray-50 min-h-full">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-6 py-5">
        <div className="max-w-6xl mx-auto">
          <h1 className="text-xl font-bold text-gray-900">Call Logs</h1>
          <p className="text-sm text-gray-400 mt-0.5">Every call Ellie has handled -- click any to expand the summary and transcript</p>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-6 space-y-6">
        {/* Quick stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <p className="text-3xl font-bold text-purple-600">{calls.length}</p>
            <p className="text-sm font-medium text-gray-700 mt-1">Total Calls</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <p className="text-3xl font-bold text-teal-600">{formatDuration(avgDuration)}</p>
            <p className="text-sm font-medium text-gray-700 mt-1">Avg Duration</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <p className="text-3xl font-bold text-blue-600">{formatDuration(totalDuration)}</p>
            <p className="text-sm font-medium text-gray-700 mt-1">Total Talk Time</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <p className={`text-3xl font-bold ${crisisCount ? 'text-red-600' : 'text-green-600'}`}>{crisisCount}</p>
            <p className="text-sm font-medium text-gray-700 mt-1">Crisis Flags</p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex gap-2">
            <button
              onClick={() => setFilter('all')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                filter === 'all' ? 'bg-teal-600 text-white' : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50'
              }`}
            >
              All Calls ({calls.length})
            </button>
            <button
              onClick={() => setFilter('new_patient')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                filter === 'new_patient' ? 'bg-purple-600 text-white' : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50'
              }`}
            >
              New Patients ({newPatientCount})
            </button>
            <button
              onClick={() => setFilter('crisis')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                filter === 'crisis' ? 'bg-red-600 text-white' : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50'
              }`}
            >
              Crisis Only ({crisisCount})
            </button>
          </div>
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input
              type="text"
              placeholder="Search by name, phone, or summary..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white"
            />
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-6 h-6 border-2 border-teal-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : error ? (
          <div className="bg-white rounded-xl border border-red-200 p-16 text-center">
            <AlertCircle className="w-10 h-10 text-red-400 mx-auto mb-3" />
            <p className="text-gray-700 font-medium">{error}</p>
            <p className="text-gray-400 text-sm mt-1">Try refreshing the page or contact support</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-white rounded-xl border border-dashed border-gray-300 p-16 text-center">
            <Phone className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 font-medium">No calls yet</p>
            <p className="text-gray-400 text-sm mt-1">Calls Ellie handles will appear here automatically</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(call => (
              <CallCard key={call.id} call={call} />
            ))}
            <p className="text-xs text-gray-400 text-center pt-2">
              Showing {filtered.length} of {calls.length} calls
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
