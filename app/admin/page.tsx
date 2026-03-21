'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-browser'
import { Phone, Users, MessageSquare, TrendingUp, PlusCircle, ArrowRight } from 'lucide-react'

interface Practice {
  id: string
  name: string
  therapist_name: string
  phone_number: string | null
  notification_email: string
  vapi_assistant_id: string | null
  created_at: string
}

interface PracticeStats {
  practiceId: string
  callCount: number
  waitlistCount: number
}

export default function AdminOverview() {
  const [practices, setPractices] = useState<Practice[]>([])
  const [stats, setStats] = useState<Record<string, PracticeStats>>({})
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    const fetchData = async () => {
      // Get all practices
      const { data: practicesData } = await supabase
        .from('practices')
        .select('*')
        .order('created_at', { ascending: false })

      if (practicesData) {
        setPractices(practicesData)

        // Get stats for each practice
        const statsMap: Record<string, PracticeStats> = {}
        for (const p of practicesData) {
          const [{ count: callCount }, { count: waitlistCount }] = await Promise.all([
            supabase.from('call_logs').select('*', { count: 'exact', head: true }).eq('practice_id', p.id).then(r => ({ count: r.count || 0 })),
            supabase.from('waitlist').select('*', { count: 'exact', head: true }).eq('practice_id', p.id).eq('status', 'waiting').then(r => ({ count: r.count || 0 })),
          ])
          statsMap[p.id] = { practiceId: p.id, callCount: callCount as number, waitlistCount: waitlistCount as number }
        }
        setStats(statsMap)
      }
      setLoading(false)
    }
    fetchData()
  }, [supabase])

  const totalCalls = Object.values(stats).reduce((sum, s) => sum + s.callCount, 0)
  const totalWaitlist = Object.values(stats).reduce((sum, s) => sum + s.waitlistCount, 0)

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Harbor Admin</h1>
          <p className="text-gray-500 mt-1">Overview of all practices</p>
        </div>
        <Link
          href="/admin/provision"
          className="flex items-center gap-2 bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <PlusCircle className="w-4 h-4" />
          Add Therapist
        </Link>
      </div>

      {/* Top stats */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-teal-50 rounded-lg flex items-center justify-center">
              <Users className="w-5 h-5 text-teal-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{practices.length}</p>
              <p className="text-sm text-gray-500">Active Practices</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center">
              <Phone className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{totalCalls}</p>
              <p className="text-sm text-gray-500">Total Calls Handled</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-orange-50 rounded-lg flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-orange-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{totalWaitlist}</p>
              <p className="text-sm text-gray-500">Patients Waiting</p>
            </div>
          </div>
        </div>
      </div>

      {/* Practice cards */}
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Practices</h2>

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <div className="w-6 h-6 border-2 border-teal-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : practices.length === 0 ? (
        <div className="bg-white rounded-xl border border-dashed border-gray-300 p-12 text-center">
          <Users className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 mb-4">No practices yet.</p>
          <Link href="/admin/provision" className="bg-teal-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-teal-700 transition-colors">
            Add your first therapist
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {practices.map(practice => {
            const s = stats[practice.id] || { callCount: 0, waitlistCount: 0 }
            return (
              <div key={practice.id} className="bg-white rounded-xl border border-gray-200 p-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-teal-100 rounded-xl flex items-center justify-center text-teal-700 font-bold text-lg">
                      {practice.therapist_name?.charAt(0) || 'T'}
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900">{practice.name}</h3>
                      <p className="text-sm text-gray-500">{practice.therapist_name}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{practice.notification_email}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-8">
                    <div className="text-center">
                      <p className="text-xl font-bold text-gray-900">{s.callCount}</p>
                      <p className="text-xs text-gray-500">Calls</p>
                    </div>
                    <div className="text-center">
                      <p className="text-xl font-bold text-gray-900">{s.waitlistCount}</p>
                      <p className="text-xs text-gray-500">Waitlist</p>
                    </div>
                    <div className="text-center">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        practice.vapi_assistant_id
                          ? 'bg-green-100 text-green-700'
                          : 'bg-yellow-100 text-yellow-700'
                      }`}>
                        {practice.vapi_assistant_id ? 'Live' : 'Setup needed'}
                      </span>
                    </div>
                    <Link
                      href={`/admin/practices/${practice.id}`}
                      className="flex items-center gap-1 text-teal-600 hover:text-teal-700 text-sm font-medium"
                    >
                      View <ArrowRight className="w-3 h-3" />
                    </Link>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
