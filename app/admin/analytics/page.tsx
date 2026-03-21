'use client'

import { useEffect, useState } from 'react'
import { Phone, Users, AlertTriangle, TrendingUp } from 'lucide-react'
import { createClient } from '@/lib/supabase-browser'

interface PracticeAnalytics {
  id: string
  name: string
  therapist_name: string
  callCount: number
  waitlistCount: number
}

export default function AdminAnalyticsPage() {
  const [loading, setLoading] = useState(true)
  const [totalCallsToday, setTotalCallsToday] = useState(0)
  const [totalCallsWeek, setTotalCallsWeek] = useState(0)
  const [totalCallsMonth, setTotalCallsMonth] = useState(0)
  const [crisisCount, setCrisisCount] = useState(0)
  const [newPracticesMonth, setNewPracticesMonth] = useState(0)
  const [practices, setPractices] = useState<PracticeAnalytics[]>([])
  const supabase = createClient()

  useEffect(() => {
    const fetchAnalytics = async () => {
      // Fetch all practices
      const { data: allPractices } = await supabase
        .from('practices')
        .select('*')
        .order('created_at', { ascending: false })

      if (allPractices && allPractices.length > 0) {
        setPractices(
          allPractices.map(p => ({
            id: p.id,
            name: p.name,
            therapist_name: p.therapist_name,
            callCount: 0,
            waitlistCount: 0,
          }))
        )
      }

      // Calculate call stats
      const today = new Date()
      today.setHours(0, 0, 0, 0)

      const weekStart = new Date()
      weekStart.setDate(weekStart.getDate() - 7)

      const monthStart = new Date()
      monthStart.setDate(1)

      const [
        { count: todayCount },
        { count: weekCount },
        { count: monthCount },
        { count: crisisAlertCount },
        { count: newPracticesCount },
      ] = await Promise.all([
        supabase
          .from('call_logs')
          .select('*', { count: 'exact', head: true })
          .gte('created_at', today.toISOString()),
        supabase
          .from('call_logs')
          .select('*', { count: 'exact', head: true })
          .gte('created_at', weekStart.toISOString()),
        supabase
          .from('call_logs')
          .select('*', { count: 'exact', head: true })
          .gte('created_at', monthStart.toISOString()),
        supabase
          .from('crisis_alerts')
          .select('*', { count: 'exact', head: true })
          .gte('triggered_at', monthStart.toISOString()),
        supabase
          .from('practices')
          .select('*', { count: 'exact', head: true })
          .gte('created_at', monthStart.toISOString()),
      ])

      setTotalCallsToday(todayCount || 0)
      setTotalCallsWeek(weekCount || 0)
      setTotalCallsMonth(monthCount || 0)
      setCrisisCount(crisisAlertCount || 0)
      setNewPracticesMonth(newPracticesCount || 0)

      // Fetch detailed stats for each practice
      if (allPractices && allPractices.length > 0) {
        const statsMap: Record<string, { calls: number; waitlist: number }> = {}

        for (const p of allPractices) {
          const [{ count: callCount }, { count: waitlistCount }] = await Promise.all([
            supabase
              .from('call_logs')
              .select('*', { count: 'exact', head: true })
              .eq('practice_id', p.id)
              .then(r => ({ count: r.count || 0 })),
            supabase
              .from('waitlist')
              .select('*', { count: 'exact', head: true })
              .eq('practice_id', p.id)
              .eq('status', 'waiting')
              .then(r => ({ count: r.count || 0 })),
          ])

          statsMap[p.id] = { calls: callCount as number, waitlist: waitlistCount as number }
        }

        setPractices(
          allPractices.map(p => ({
            id: p.id,
            name: p.name,
            therapist_name: p.therapist_name,
            callCount: statsMap[p.id]?.calls || 0,
            waitlistCount: statsMap[p.id]?.waitlist || 0,
          }))
        )
      }

      setLoading(false)
    }

    fetchAnalytics()
  }, [supabase])

  // Get top 5 practices by call count
  const topPractices = [...practices]
    .sort((a, b) => b.callCount - a.callCount)
    .slice(0, 5)

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
        <p className="text-gray-500 mt-1">System-wide metrics and practice overview</p>
      </div>

      {/* Key stats */}
      <div className="grid grid-cols-2 gap-4 mb-8">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="w-10 h-10 bg-teal-50 rounded-lg flex items-center justify-center mb-3">
            <Phone className="w-5 h-5 text-teal-600" />
          </div>
          <p className="text-2xl font-bold text-gray-900">{totalCallsToday}</p>
          <p className="text-sm text-gray-500 mt-0.5">Calls Today</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center mb-3">
            <TrendingUp className="w-5 h-5 text-blue-600" />
          </div>
          <p className="text-2xl font-bold text-gray-900">{totalCallsWeek}</p>
          <p className="text-sm text-gray-500 mt-0.5">Calls This Week</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="w-10 h-10 bg-green-50 rounded-lg flex items-center justify-center mb-3">
            <Phone className="w-5 h-5 text-green-600" />
          </div>
          <p className="text-2xl font-bold text-gray-900">{totalCallsMonth}</p>
          <p className="text-sm text-gray-500 mt-0.5">Calls This Month</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="w-10 h-10 bg-red-50 rounded-lg flex items-center justify-center mb-3">
            <AlertTriangle className="w-5 h-5 text-red-600" />
          </div>
          <p className="text-2xl font-bold text-gray-900">{crisisCount}</p>
          <p className="text-sm text-gray-500 mt-0.5">Crisis Alerts</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="w-10 h-10 bg-purple-50 rounded-lg flex items-center justify-center mb-3">
            <Users className="w-5 h-5 text-purple-600" />
          </div>
          <p className="text-2xl font-bold text-gray-900">{newPracticesMonth}</p>
          <p className="text-sm text-gray-500 mt-0.5">New Practices</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="w-10 h-10 bg-orange-50 rounded-lg flex items-center justify-center mb-3">
            <Users className="w-5 h-5 text-orange-600" />
          </div>
          <p className="text-2xl font-bold text-gray-900">{practices.length}</p>
          <p className="text-sm text-gray-500 mt-0.5">Total Practices</p>
        </div>
      </div>

      {/* Top practices */}
      {topPractices.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 mb-8">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Top 5 Most Active Practices</h2>
          </div>

          <div className="divide-y divide-gray-100">
            {topPractices.map((practice, idx) => (
              <div key={practice.id} className="px-5 py-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-teal-100 rounded-lg flex items-center justify-center text-teal-700 font-bold">
                    {idx + 1}
                  </div>
                  <div>
                    <p className="font-medium text-gray-900">{practice.name}</p>
                    <p className="text-xs text-gray-500">{practice.therapist_name}</p>
                  </div>
                </div>

                <div className="flex items-center gap-8">
                  <div className="text-right">
                    <p className="text-lg font-bold text-gray-900">{practice.callCount}</p>
                    <p className="text-xs text-gray-500">calls</p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold text-gray-900">{practice.waitlistCount}</p>
                    <p className="text-xs text-gray-500">waiting</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* All practices table */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">All Practices</h2>
        </div>

        {practices.length === 0 ? (
          <div className="p-12 text-center">
            <Users className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500">No practices yet</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-600">Practice</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-600">Therapist</th>
                  <th className="text-center px-5 py-3 text-xs font-semibold text-gray-600">Total Calls</th>
                  <th className="text-center px-5 py-3 text-xs font-semibold text-gray-600">Waitlist</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {practices.map(practice => (
                  <tr key={practice.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-4 font-medium text-gray-900">{practice.name}</td>
                    <td className="px-5 py-4 text-sm text-gray-600">{practice.therapist_name}</td>
                    <td className="px-5 py-4 text-center text-gray-900 font-medium">{practice.callCount}</td>
                    <td className="px-5 py-4 text-center text-gray-900 font-medium">{practice.waitlistCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
