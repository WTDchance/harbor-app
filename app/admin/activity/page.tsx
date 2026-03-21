'use client'

import { useState, useEffect } from 'react'
import { Phone, Clock, AlertTriangle } from 'lucide-react'
import { createClient } from '@/lib/supabase-browser'

interface ActivityLog {
  id: string
  patient_phone: string
  duration_seconds: number
  created_at: string
  crisis_detected?: boolean
  practices?: {
    name: string
    therapist_name: string
  }
}

interface PatientArrival {
  id: string
  patient_name: string | null
  patient_phone: string
  arrived_at: string
  therapist_notified: boolean
  practices?: {
    name: string
  }
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
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}

function getDateRange(range: string): { start: Date; end: Date } {
  const end = new Date()
  const start = new Date()

  switch (range) {
    case '24h':
      start.setDate(start.getDate() - 1)
      break
    case '7d':
      start.setDate(start.getDate() - 7)
      break
    default:
      start.setHours(0, 0, 0, 0)
      end.setHours(23, 59, 59, 999)
  }

  return { start, end }
}

export default function AdminActivityPage() {
  const [logs, setLogs] = useState<ActivityLog[]>([])
  const [arrivals, setArrivals] = useState<PatientArrival[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'crisis' | '24h' | '7d'>('all')
  const supabase = createClient()

  useEffect(() => {
    const fetchLogs = async () => {
      let query = supabase
        .from('call_logs')
        .select('id, patient_phone, duration_seconds, created_at, crisis_detected, practices(name, therapist_name)')
        .order('created_at', { ascending: false })
        .limit(100)

      // Apply filters
      if (filter === 'crisis') {
        query = query.eq('crisis_detected', true)
      } else if (filter === '24h' || filter === '7d') {
        const { start, end } = getDateRange(filter)
        query = query.gte('created_at', start.toISOString()).lte('created_at', end.toISOString())
      }

      const { data } = await query
      setLogs(data || [])
      setLoading(false)
    }

    fetchLogs()
  }, [filter, supabase])

  useEffect(() => {
    const fetchArrivals = async () => {
      const { data } = await supabase
        .from('patient_arrivals')
        .select('id, patient_name, patient_phone, arrived_at, therapist_notified, practices(name)')
        .order('arrived_at', { ascending: false })
        .limit(20)
      setArrivals(data || [])
    }

    fetchArrivals()
  }, [supabase])

  const crisisCount = logs.filter(l => l.crisis_detected).length
  const today = logs.filter(l => {
    const logDate = new Date(l.created_at)
    const now = new Date()
    return logDate.toDateString() === now.toDateString()
  }).length

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Activity Feed</h1>
        <p className="text-gray-500 mt-1">Real-time view of all calls across practices</p>
      </div>

      {/* Top stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-sm text-gray-500">Calls Today</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{today}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-sm text-gray-500">Total Calls (all time)</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{logs.length}</p>
        </div>
        <div className="bg-white rounded-xl border border-red-200 p-4">
          <p className="text-sm text-red-600 font-medium">Crisis Alerts</p>
          <p className="text-2xl font-bold text-red-600 mt-1">{crisisCount}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        {[
          { value: 'all', label: 'All' },
          { value: 'crisis', label: 'Crisis Only' },
          { value: '24h', label: 'Last 24h' },
          { value: '7d', label: 'Last 7d' },
        ].map(({ value, label }) => (
          <button
            key={value}
            onClick={() => setFilter(value as any)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              filter === value
                ? 'bg-teal-600 text-white'
                : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Recent Arrivals */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="font-semibold text-gray-900">Recent Arrivals</h2>
        </div>
        {arrivals.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-gray-500 text-sm">No patient arrivals recorded yet</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left font-semibold text-gray-700">Practice</th>
                  <th className="px-6 py-3 text-left font-semibold text-gray-700">Patient</th>
                  <th className="px-6 py-3 text-left font-semibold text-gray-700">Arrived</th>
                  <th className="px-6 py-3 text-left font-semibold text-gray-700">Therapist Notified</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {arrivals.map(arrival => (
                  <tr key={arrival.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4 font-medium text-gray-900">{(arrival.practices as any)?.name || '-'}</td>
                    <td className="px-6 py-4 text-gray-600">{arrival.patient_name || arrival.patient_phone}</td>
                    <td className="px-6 py-4 text-gray-600">{timeAgo(arrival.arrived_at)}</td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${
                        arrival.therapist_notified
                          ? 'bg-green-100 text-green-700'
                          : 'bg-yellow-100 text-yellow-700'
                      }`}>
                        {arrival.therapist_notified ? '✓ Yes' : 'Pending'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center h-40">
          <div className="w-6 h-6 border-2 border-teal-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : logs.length === 0 ? (
        <div className="bg-white rounded-xl border border-dashed border-gray-300 p-12 text-center">
          <Phone className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">No calls yet</p>
          <p className="text-gray-400 text-sm mt-1">Calls will appear here as they happen</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left font-semibold text-gray-700">Practice</th>
                  <th className="px-6 py-3 text-left font-semibold text-gray-700">Therapist</th>
                  <th className="px-6 py-3 text-left font-semibold text-gray-700">Caller</th>
                  <th className="px-6 py-3 text-left font-semibold text-gray-700">Duration</th>
                  <th className="px-6 py-3 text-left font-semibold text-gray-700">Time</th>
                  <th className="px-6 py-3 text-left font-semibold text-gray-700">Crisis?</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {logs.map(log => (
                  <tr key={log.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4 font-medium text-gray-900">{(log.practices as any)?.name || '-'}</td>
                    <td className="px-6 py-4 text-gray-600">{(log.practices as any)?.therapist_name || '-'}</td>
                    <td className="px-6 py-4 text-gray-600">{log.patient_phone}</td>
                    <td className="px-6 py-4 text-gray-600">{formatDuration(log.duration_seconds)}</td>
                    <td className="px-6 py-4 text-gray-600">{timeAgo(log.created_at)}</td>
                    <td className="px-6 py-4">
                      {log.crisis_detected ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-700">
                          <AlertTriangle className="w-3 h-3" />
                          Crisis
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
