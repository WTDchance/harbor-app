'use client'

import { useState, useEffect } from 'react'
import { Search, Phone, Clock, ChevronDown, ChevronUp } from 'lucide-react'
import { createClient } from '@/lib/supabase-browser'

interface CallLog {
  id: string
  patient_phone: string
  duration_seconds: number
  summary: string | null
  transcript: string | null
  created_at: string
}

function formatDuration(seconds: number) {
  if (!seconds) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function CallCard({ call }: { call: CallLog }) {
  const [expanded, setExpanded] = useState(false)

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
            <p className="font-semibold text-gray-900">{call.patient_phone}</p>
            <div className="flex items-center gap-3 text-sm text-gray-400">
              <span className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                {formatDuration(call.duration_seconds)}
              </span>
              <span>{timeAgo(call.created_at)}</span>
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
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    const fetchCalls = async () => {
      // Get the logged-in user's practice
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      // Find their practice
      const { data: practice } = await supabase
        .from('practices')
        .select('id')
        .eq('notification_email', user.email)
        .single()

      const practiceId = practice?.id

      let query = supabase
        .from('call_logs')
        .select('id, patient_phone, duration_seconds, summary, transcript, created_at')
        .order('created_at', { ascending: false })
        .limit(100)

      if (practiceId) {
        query = query.eq('practice_id', practiceId)
      }

      const { data } = await query
      setCalls(data || [])
      setLoading(false)
    }

    fetchCalls()
  }, [supabase])

  const filtered = calls.filter(c =>
    c.patient_phone?.includes(search) ||
    c.summary?.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Call Logs</h1>
        <p className="text-gray-500 mt-1">Every call Ellie has handled — click any to expand the summary and transcript</p>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
        <input
          type="text"
          placeholder="Search by phone or summary..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <div className="w-6 h-6 border-2 border-teal-600 border-t-transparent rounded-full animate-spin" />
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
  )
}
