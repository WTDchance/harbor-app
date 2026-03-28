'use client'

import { useState, useEffect } from 'react'
import { Search, Phone, Clock, ChevronDown, ChevronUp, AlertCircle, FileText, MessageSquare } from 'lucide-react'
import { createClient } from '@/lib/supabase-browser'

interface CallLog {
  id: string
  patient_phone: string
  duration_seconds: number
  summary: string | null
  transcript: string | null
  created_at: string
  crisis_detected?: boolean
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

function getScreeningBadgeColor(score: number): string {
  if (score >= 3) return 'bg-red-100 text-red-700'
  if (score >= 2) return 'bg-yellow-100 text-yellow-700'
  return 'bg-green-100 text-green-700'
}

function formatTranscript(transcript: string): Array<{ speaker: string; text: string }> {
  const lines = transcript.split('\n').filter(l => l.trim())
  return lines.map(line => {
    const colonIdx = line.indexOf(':')
    if (colonIdx > 0 && colonIdx < 30) {
      return {
        speaker: line.substring(0, colonIdx).trim(),
        text: line.substring(colonIdx + 1).trim()
      }
    }
    return { speaker: '', text: line.trim() }
  })
}

export default function CallsPage() {
  const [calls, setCalls] = useState<CallLog[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'crisis'>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedCallId, setExpandedCallId] = useState<string | null>(null)

  useEffect(() => {
    loadCalls()
  }, [])

  async function loadCalls() {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data: userRecord } = await supabase
      .from('users')
      .select('practice_id')
      .eq('id', user.id)
      .single()

    const practiceId = userRecord?.practice_id
    if (!practiceId) return

    const { data } = await supabase
      .from('call_logs')
      .select('*')
      .eq('practice_id', practiceId)
      .order('created_at', { ascending: false })
      .limit(100)

    if (data) setCalls(data)
    setLoading(false)
  }

  const filtered = calls.filter(c => {
    if (filter === 'crisis' && !c.crisis_detected) return false
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      return (
        c.patient_phone?.toLowerCase().includes(q) ||
        c.summary?.toLowerCase().includes(q) ||
        c.transcript?.toLowerCase().includes(q)
      )
    }
    return true
  })

  const totalCalls = calls.length
  const crisisCount = calls.filter(c => c.crisis_detected).length
  const avgDuration = totalCalls > 0
    ? Math.round(calls.reduce((sum, c) => sum + (c.duration_seconds || 0), 0) / totalCalls)
    : 0
  const totalTalkTime = calls.reduce((sum, c) => sum + (c.duration_seconds || 0), 0)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Call Logs</h1>
            <p className="text-sm text-gray-500 mt-1">Review transcripts and summaries from your AI receptionist</p>
          </div>
        </div>

        {/* Stats Bar */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-sm text-gray-500">Total Calls</p>
            <p className="text-2xl font-bold text-gray-900">{totalCalls}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-sm text-gray-500">Avg Duration</p>
            <p className="text-2xl font-bold text-gray-900">{formatDuration(avgDuration)}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-sm text-gray-500">Total Talk Time</p>
            <p className="text-2xl font-bold text-gray-900">{formatDuration(totalTalkTime)}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-sm text-gray-500">Crisis Flags</p>
            <p className={`text-2xl font-bold ${crisisCount > 0 ? 'text-red-600' : 'text-gray-900'}`}>{crisisCount}</p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 mb-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search calls..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>
          <button
            onClick={() => setFilter('all')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              filter === 'all'
                ? 'bg-teal-600 text-white'
                : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
            }`}
          >
            All Calls ({totalCalls})
          </button>
          <button
            onClick={() => setFilter('crisis')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              filter === 'crisis'
                ? 'bg-red-600 text-white'
                : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
            }`}
          >
            Crisis Only ({crisisCount})
          </button>
        </div>

        {/* Call List */}
        <div className="space-y-2">
          {filtered.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
              <Phone className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500">No calls found</p>
            </div>
          ) : (
            filtered.map((call) => {
              const isExpanded = expandedCallId === call.id
              const phq2Score = call.intake_screenings?.[0]?.phq2_score
              const gad2Score = call.intake_screenings?.[0]?.gad2_score
              const hasTranscript = call.transcript && call.transcript.length > 0
              const transcriptLines = hasTranscript ? formatTranscript(call.transcript!) : []

              return (
                <div key={call.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden transition-shadow hover:shadow-sm">
                  {/* Call Row Header */}
                  <div
                    className="flex items-center gap-4 p-4 cursor-pointer hover:bg-gray-50 transition-colors"
                    onClick={() => setExpandedCallId(isExpanded ? null : call.id)}
                  >
                    <div className="w-10 h-10 bg-teal-100 rounded-full flex items-center justify-center flex-shrink-0">
                      <Phone className="w-4 h-4 text-teal-600" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-gray-900">{call.patient_phone}</p>
                          {call.crisis_detected && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700">
                              <AlertCircle className="w-3 h-3" />
                              Crisis
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
                          {hasTranscript && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs text-teal-600 bg-teal-50">
                              <FileText className="w-3 h-3" />
                              Transcript
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-sm text-gray-500 flex-shrink-0">
                          <span className="flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5" />
                            {formatDuration(call.duration_seconds)}
                          </span>
                          <span>
                            {new Date(call.created_at).toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              hour: 'numeric',
                              minute: '2-digit',
                            })}
                          </span>
                          {isExpanded ? (
                            <ChevronUp className="w-4 h-4 text-gray-400" />
                          ) : (
                            <ChevronDown className="w-4 h-4 text-gray-400" />
                          )}
                        </div>
                      </div>

                      {/* Summary preview (always visible if available) */}
                      {call.summary && !isExpanded && (
                        <p className="text-sm text-gray-500 mt-1 truncate">{call.summary}</p>
                      )}
                    </div>
                  </div>

                  {/* Expanded Content */}
                  {isExpanded && (
                    <div className="border-t border-gray-100 bg-gray-50">
                      {/* Summary Section */}
                      {call.summary && (
                        <div className="px-4 pt-4 pb-2">
                          <div className="flex items-center gap-2 mb-2">
                            <MessageSquare className="w-4 h-4 text-teal-600" />
                            <h4 className="text-sm font-semibold text-gray-700">AI Summary</h4>
                          </div>
                          <p className="text-sm text-gray-600 bg-white rounded-lg p-3 border border-gray-200">
                            {call.summary}
                          </p>
                        </div>
                      )}

                      {/* Transcript Section */}
                      {hasTranscript ? (
                        <div className="px-4 pt-2 pb-4">
                          <div className="flex items-center gap-2 mb-2">
                            <FileText className="w-4 h-4 text-teal-600" />
                            <h4 className="text-sm font-semibold text-gray-700">Transcript</h4>
                          </div>
                          <div className="bg-white rounded-lg border border-gray-200 p-4 max-h-96 overflow-y-auto space-y-3">
                            {transcriptLines.map((line, i) => (
                              <div key={i} className={`text-sm ${
                                line.speaker.toLowerCase().includes('caller')
                                  ? 'pl-0'
                                  : 'pl-4'
                              }`}>
                                {line.speaker ? (
                                  <>
                                    <span className={`font-semibold ${
                                      line.speaker.toLowerCase().includes('caller')
                                        ? 'text-blue-700'
                                        : 'text-teal-700'
                                    }`}>
                                      {line.speaker}:
                                    </span>{' '}
                                    <span className="text-gray-700">{line.text}</span>
                                  </>
                                ) : (
                                  <span className="text-gray-600">{line.text}</span>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div className="px-4 pt-2 pb-4">
                          <div className="bg-white rounded-lg border border-gray-200 p-6 text-center">
                            <FileText className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                            <p className="text-sm text-gray-400">No transcript available for this call</p>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
