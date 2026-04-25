'use client'

import { useEffect, useState } from 'react'
import { Phone, Clock, Users, AlertTriangle, TrendingUp, Frown } from 'lucide-react'
import { createClient } from '@/lib/supabase-browser'

interface CallStats {
  totalCalls: number
  avgDuration: number
  callsAnswered: number
  callsMissed: number
  busiestDay: string
  busiestHour: number
}

interface WaitlistStats {
  total: number
  avgWaitTime: number
  fillRate: number
}

interface CrisisStats {
  totalThisMonth: number
}

interface ScreeningStats {
  avgPhq2: number
  avgGad2: number
  totalScreenings: number
}

export default function AnalyticsPage() {
  const [loading, setLoading] = useState(true)
  const [callStats, setCallStats] = useState<CallStats | null>(null)
  const [waitlistStats, setWaitlistStats] = useState<WaitlistStats | null>(null)
  const [crisisStats, setCrisisStats] = useState<CrisisStats | null>(null)
  const [screeningStats, setScreeningStats] = useState<ScreeningStats | null>(null)
  const [callsByDay, setCallsByDay] = useState<Array<{ day: string; count: number }>>([])
  const [callsByHour, setCallsByHour] = useState<Array<{ hour: number; count: number }>>([])
  const supabase = createClient()

  useEffect(() => {
    const fetchAnalytics = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        setLoading(false)
        return
      }

      // Resolve practice via server-side endpoint (respects act-as cookie)
      const meRes = await fetch('/api/practice/me')
      const meData = meRes.ok ? await meRes.json() : null
      const practice = meData?.practice

      if (!practice) {
        setLoading(false)
        return
      }

      // Fetch call logs for last 30 days
      const thirtyDaysAgo = new Date()
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

      const { data: callLogs } = await supabase
        .from('call_logs')
        .select('duration_seconds, created_at, status')
        .eq('practice_id', practice.id)
        .gte('created_at', thirtyDaysAgo.toISOString())

      // Fetch this month's calls
      const monthStart = new Date()
      monthStart.setDate(1)

      const { data: monthCalls } = await supabase
        .from('call_logs')
        .select('duration_seconds, created_at, status')
        .eq('practice_id', practice.id)
        .gte('created_at', monthStart.toISOString())

      // Fetch waitlist
      const { data: waitlist } = await supabase
        .from('waitlist')
        .select('id, added_at, status')
        .eq('practice_id', practice.id)
        .eq('status', 'waiting')

      // Fetch crisis alerts this month
      const { count: crisisCount } = await supabase
        .from('crisis_alerts')
        .select('*', { count: 'exact', head: true })
        .eq('practice_id', practice.id)
        .gte('triggered_at', monthStart.toISOString())

      // Fetch intake screenings this month
      const { data: screenings } = await supabase
        .from('intake_screenings')
        .select('phq2_score, gad2_score')
        .eq('practice_id', practice.id)
        .gte('created_at', monthStart.toISOString())

      // Calculate call stats
      if (callLogs && callLogs.length > 0) {
        const totalDuration = callLogs.reduce((sum, c) => sum + (c.duration_seconds || 0), 0)
        const avgDur = Math.round(totalDuration / callLogs.length)
        const answered = callLogs.filter(c => c.status === 'completed').length
        const missed = callLogs.filter(c => c.status === 'missed').length

        // Calculate busiest day
        const dayMap: Record<string, number> = {}
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
        callLogs.forEach(call => {
          const date = new Date(call.created_at)
          const day = days[date.getDay()]
          dayMap[day] = (dayMap[day] || 0) + 1
        })
        const busiestDay = Object.entries(dayMap).reduce((a, b) => a[1] > b[1] ? a : b)[0]

        // Calculate busiest hour
        const hourMap: Record<number, number> = {}
        callLogs.forEach(call => {
          const hour = new Date(call.created_at).getHours()
          hourMap[hour] = (hourMap[hour] || 0) + 1
        })
        const busiestHour = Object.entries(hourMap).reduce((a, b) => a[1] > b[1] ? a : b)?.[0] || 0

        setCallStats({
          totalCalls: monthCalls?.length || 0,
          avgDuration: avgDur,
          callsAnswered: answered,
          callsMissed: missed,
          busiestDay,
          busiestHour: parseInt(busiestHour as unknown as string),
        })

        // Prepare calls by day for last 30 days
        const dayCountMap: Record<string, number> = {}
        callLogs.forEach(call => {
          const date = new Date(call.created_at)
          const dayStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
          dayCountMap[dayStr] = (dayCountMap[dayStr] || 0) + 1
        })
        setCallsByDay(Object.entries(dayCountMap).map(([day, count]) => ({ day, count })))

        // Prepare calls by hour
        const hourCountMap: Record<number, number> = {}
        callLogs.forEach(call => {
          const hour = new Date(call.created_at).getHours()
          hourCountMap[hour] = (hourCountMap[hour] || 0) + 1
        })
        setCallsByHour(
          Array.from({ length: 24 }, (_, i) => ({ hour: i, count: hourCountMap[i] || 0 }))
        )
      }

      // Calculate waitlist stats
      if (waitlist && waitlist.length > 0) {
        const avgWaitMs = waitlist.reduce((sum, w) => {
          return sum + (new Date().getTime() - new Date(w.added_at).getTime())
        }, 0) / waitlist.length
        const avgWaitHours = Math.round(avgWaitMs / (1000 * 60 * 60))

        setWaitlistStats({
          total: waitlist.length,
          avgWaitTime: avgWaitHours,
          fillRate: monthCalls?.length ? Math.round((answered / monthCalls.length) * 100) : 0,
        })
      }

      // Set crisis stats
      setCrisisStats({
        totalThisMonth: crisisCount || 0,
      })

      // Calculate screening stats
      if (screenings && screenings.length > 0) {
        const avgPhq2 = Math.round(
          screenings.reduce((sum, s) => sum + (s.phq2_score || 0), 0) / screenings.length
        )
        const avgGad2 = Math.round(
          screenings.reduce((sum, s) => sum + (s.gad2_score || 0), 0) / screenings.length
        )
        setScreeningStats({
          avgPhq2,
          avgGad2,
          totalScreenings: screenings.length,
        })
      }

      setLoading(false)
    }

    fetchAnalytics()
  }, [supabase])

  const getMaxCallsByDay = () => Math.max(...callsByDay.map(d => d.count), 1)
  const getMaxCallsByHour = () => Math.max(...callsByHour.map(h => h.count), 1)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-6 h-6 border-2 border-teal-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Analytics</h1>
        <p className="text-gray-500 mt-1">Call volume and performance metrics for this month</p>
      </div>

      {/* Key stat cards */}
      <div className="grid grid-cols-2 gap-4 mb-8">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="w-10 h-10 bg-teal-50 rounded-lg flex items-center justify-center mb-3">
            <Phone className="w-5 h-5 text-teal-600" />
          </div>
          <p className="text-2xl font-bold text-gray-900">{callStats?.totalCalls ?? '—'}</p>
          <p className="text-sm text-gray-500 mt-0.5">Total Calls This Month</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center mb-3">
            <Clock className="w-5 h-5 text-blue-600" />
          </div>
          <p className="text-2xl font-bold text-gray-900">
            {callStats?.avgDuration ? `${Math.floor(callStats.avgDuration / 60)}:${(callStats.avgDuration % 60).toString().padStart(2, '0')}` : '—'}
          </p>
          <p className="text-sm text-gray-500 mt-0.5">Avg Call Duration</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="w-10 h-10 bg-green-50 rounded-lg flex items-center justify-center mb-3">
            <TrendingUp className="w-5 h-5 text-green-600" />
          </div>
          <p className="text-2xl font-bold text-gray-900">{callStats?.callsAnswered ?? '—'}</p>
          <p className="text-sm text-gray-500 mt-0.5">Calls Answered</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="w-10 h-10 bg-orange-50 rounded-lg flex items-center justify-center mb-3">
            <Users className="w-5 h-5 text-orange-600" />
          </div>
          <p className="text-2xl font-bold text-gray-900">{waitlistStats?.total ?? '—'}</p>
          <p className="text-sm text-gray-500 mt-0.5">On Waitlist</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="w-10 h-10 bg-red-50 rounded-lg flex items-center justify-center mb-3">
            <AlertTriangle className="w-5 h-5 text-red-600" />
          </div>
          <p className="text-2xl font-bold text-gray-900">{crisisStats?.totalThisMonth ?? '—'}</p>
          <p className="text-sm text-gray-500 mt-0.5">Crisis Alerts</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="w-10 h-10 bg-purple-50 rounded-lg flex items-center justify-center mb-3">
            <Frown className="w-5 h-5 text-purple-600" />
          </div>
          <p className="text-2xl font-bold text-gray-900">{screeningStats?.totalScreenings ?? '—'}</p>
          <p className="text-sm text-gray-500 mt-0.5">Intake Screenings</p>
        </div>
      </div>

      {/* Busiest day and hour */}
      <div className="grid grid-cols-2 gap-4 mb-8">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-900 mb-3">Busiest Day</h3>
          <p className="text-3xl font-bold text-teal-600">{callStats?.busiestDay}</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-900 mb-3">Busiest Hour</h3>
          <p className="text-3xl font-bold text-teal-600">
            {callStats?.busiestHour}:00<span className="text-lg text-gray-500"> {callStats?.busiestHour ?? 0 < 12 ? 'AM' : 'PM'}</span>
          </p>
        </div>
      </div>

      {/* Screening averages */}
      {screeningStats && screeningStats.totalScreenings > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-8">
          <h3 className="font-semibold text-gray-900 mb-4">Mental Health Screening Averages</h3>
          <div className="grid grid-cols-2 gap-6">
            <div>
              <p className="text-sm text-gray-600 mb-2">PHQ-2 (Depression)</p>
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-bold text-blue-600">{screeningStats.avgPhq2}</span>
                <span className="text-sm text-gray-500">/ 6</span>
              </div>
            </div>
            <div>
              <p className="text-sm text-gray-600 mb-2">GAD-2 (Anxiety)</p>
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-bold text-purple-600">{screeningStats.avgGad2}</span>
                <span className="text-sm text-gray-500">/ 6</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Calls by day chart (simple SVG) */}
      {callsByDay.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-8">
          <h3 className="font-semibold text-gray-900 mb-4">Call Volume (Last 30 Days)</h3>
          <div className="flex items-end gap-1 h-32">
            {callsByDay.slice(-14).map((item, idx) => {
              const maxCalls = getMaxCallsByDay()
              const height = maxCalls > 0 ? (item.count / maxCalls) * 100 : 0
              return (
                <div key={idx} className="flex-1 group relative">
                  <div
                    className="w-full bg-teal-500 rounded-t transition-colors hover:bg-teal-600"
                    style={{ height: `${Math.max(height, 5)}%` }}
                    title={`${item.day}: ${item.count} calls`}
                  />
                  <p className="text-xs text-gray-500 text-center mt-2">{item.day.split(' ')[0]}</p>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Calls by hour chart (simple SVG) */}
      {callsByHour.some(h => h.count > 0) && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-900 mb-4">Calls by Hour of Day</h3>
          <div className="flex items-end gap-0.5 h-32">
            {callsByHour.map((item, idx) => {
              const maxCalls = getMaxCallsByHour()
              const height = maxCalls > 0 ? (item.count / maxCalls) * 100 : 0
              return (
                <div key={idx} className="flex-1 group relative">
                  <div
                    className="w-full bg-blue-500 rounded-t transition-colors hover:bg-blue-600"
                    style={{ height: `${Math.max(height, 3)}%` }}
                    title={`${item.hour}:00 - ${item.count} calls`}
                  />
                </div>
              )
            })}
          </div>
          <div className="flex justify-between text-xs text-gray-500 mt-2">
            <span>12 AM</span>
            <span>6 AM</span>
            <span>12 PM</span>
            <span>6 PM</span>
            <span>12 AM</span>
          </div>
        </div>
      )}
    </div>
  )
}
