'use client'

import { useState, useEffect } from 'react'
import { AlertTriangle, CheckCircle, Phone, Clock } from 'lucide-react'
import { createClient } from '@/lib/supabase-browser'

interface CrisisAlert {
  id: string
  call_log_id: string
  patient_phone: string
  keywords_found: string[]
  reviewed: boolean
  reviewed_at: string | null
  created_at: string
  call_logs?: {
    summary: string | null
    duration_seconds: number
    transcript: string | null
  }
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function formatDuration(seconds: number) {
  if (!seconds) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function CrisisPage() {
  const [alerts, setAlerts] = useState<CrisisAlert[]>([])
  const [loading, setLoading] = useState(true)
  const [marking, setMarking] = useState<string | null>(null)
  const supabase = createClient()

  const fetchAlerts = async (isInitial = false) => {
    if (isInitial) setLoading(true)
    // Get the logged-in user's practice
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoading(false); return }

    // Find their practice via user record
    const { data: userData } = await supabase
      .from('users')
      .select('practice_id')
      .eq('id', user.id)
      .single()

    const practiceId = userData?.practice_id
    if (!practiceId) { setLoading(false); return }

    // Get crisis alerts
    let query = supabase
      .from('crisis_alerts')
      .select('id, call_log_id, patient_phone, keywords_found, reviewed, reviewed_at, created_at, call_logs(summary, duration_seconds, transcript)')
      .eq('practice_id', practiceId)
      .order('created_at', { ascending: false })

    const { data } = await query
    setAlerts(data || [])
    setLoading(false)
  }

  useEffect(() => {
    fetchAlerts(true)
  }, [supabase])

  // Auto-refresh crisis alerts every 30 seconds (urgent data)
  useEffect(() => {
    const interval = setInterval(() => fetchAlerts(), 30000)
    return () => clearInterval(interval)
  }, [supabase])

  const unreviewed = alerts.filter(a => !a.reviewed)

  const handleMarkReviewed = async (id: string) => {
    setMarking(id)
    try {
      const res = await fetch(`/api/crisis/${id}/review`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
      })
      if (res.ok) {
        setAlerts(a => a.map(alert => alert.id === id ? { ...alert, reviewed: true, reviewed_at: new Date().toISOString() } : alert))
      }
    } catch (error) {
      console.error('Error marking reviewed:', error)
    }
    setMarking(null)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40">
        <div className="w-6 h-6 border-2 border-teal-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (unreviewed.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Crisis Alerts</h1>
          <p className="text-gray-500 mt-1">Calls flagged as potential crisis situations</p>
        </div>

        <div className="bg-white rounded-xl border border-green-200 p-12 text-center">
          <CheckCircle className="w-12 h-12 text-green-600 mx-auto mb-3" />
          <p className="text-gray-600 font-medium">No unreviewed crisis alerts</p>
          <p className="text-gray-400 text-sm mt-1">All crisis alerts have been reviewed. Great work!</p>
        </div>

        {alerts.length > 0 && (
          <div>
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Reviewed alerts</h2>
            <div className="space-y-3">
              {alerts.map(alert => (
                <div key={alert.id} className="bg-white rounded-xl border border-gray-200 p-4 opacity-50">
                  <div className="flex items-start gap-3">
                    <CheckCircle className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-gray-900">{alert.patient_phone}</p>
                      <p className="text-xs text-gray-400">Reviewed {timeAgo(alert.reviewed_at!)}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Crisis Alerts</h1>
        <p className="text-gray-500 mt-1">Calls flagged as potential crisis situations</p>
      </div>

      <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex gap-3">
        <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold text-red-900">Immediate follow-up required</p>
          <p className="text-sm text-red-700 mt-0.5">{unreviewed.length} unreviewed alert{unreviewed.length !== 1 ? 's' : ''} need your attention</p>
        </div>
      </div>

      <div className="space-y-3">
        {unreviewed.map(alert => {
          const call = alert.call_logs
          return (
            <div key={alert.id} className="bg-white rounded-xl border border-red-200 overflow-hidden">
              <div className="p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <AlertTriangle className="w-5 h-5 text-red-600" />
                      <p className="font-semibold text-gray-900">{alert.patient_phone}</p>
                    </div>
                    <div className="flex items-center gap-4 text-sm text-gray-500 mb-3">
                      <span>{timeAgo(alert.created_at)}</span>
                      {call && <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" />{formatDuration(call.duration_seconds)}</span>}
                    </div>
                    {alert.keywords_found?.length > 0 && (
                      <div className="flex flex-wrap gap-2 mb-3">
                        {alert.keywords_found.map(keyword => (
                          <span key={keyword} className="px-2.5 py-1 rounded-full text-xs bg-red-100 text-red-700 font-medium">
                            {keyword}
                          </span>
                        ))}
                      </div>
                    )}
                    {call?.summary && (
                      <p className="text-sm text-gray-600 bg-gray-50 rounded-lg p-3 mb-3">{call.summary}</p>
                    )}
                  </div>
                  <button
                    onClick={() => handleMarkReviewed(alert.id)}
                    disabled={marking === alert.id}
                    className="flex-shrink-0 px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
                  >
                    {marking === alert.id ? 'Marking...' : 'Mark Reviewed'}
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
