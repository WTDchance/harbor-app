'use client'

import { useEffect, useState } from 'react'
import { Phone, MessageSquare, Calendar, Users } from 'lucide-react'
import { StatsCard } from '@/components/StatsCard'
import { CallCard } from '@/components/CallCard'
import type { CallLog, DashboardStats } from '@/types'

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats>({
    callsToday: 0,
    messagesToday: 0,
    appointmentsToday: 0,
    newPatientsThisWeek: 0,
  })
  const [recentCalls, setRecentCalls] = useState<CallLog[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Fetch dashboard data
    const fetchData = async () => {
      try {
        // In a real app, these would be actual API calls
        // For now, we'll use mock data
        setStats({
          callsToday: 12,
          messagesToday: 8,
          appointmentsToday: 3,
          newPatientsThisWeek: 5,
        })

        setRecentCalls([
          {
            id: 'call-001',
            practice_id: 'practice-001',
            patient_phone: '+15551112222',
            duration_seconds: 447,
            transcript:
              "Sam: Good afternoon, this is Sam with Hope and Harmony Counseling. How can I help you today?\nCaller: Hi, I'm looking to schedule an appointment with someone who specializes in anxiety.",
            summary: 'New patient intake: anxiety concerns, scheduled for Thursday 2 PM',
            vapi_call_id: 'call_demo_001',
            created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
          },
          {
            id: 'call-002',
            practice_id: 'practice-001',
            patient_phone: '+15551113333',
            duration_seconds: 312,
            transcript: '',
            summary: 'Appointment confirmation: existing patient',
            vapi_call_id: 'call_demo_002',
            created_at: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
          },
        ])
      } catch (error) {
        console.error('Error fetching dashboard data:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [])

  return (
    <div className="space-y-8">
      {/* Page header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-600 mt-2">Overview of your practice activity</p>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatsCard
          icon={<Phone className="w-8 h-8" />}
          label="Calls Today"
          value={stats.callsToday}
          subtext="AI receptionist"
        />
        <StatsCard
          icon={<MessageSquare className="w-8 h-8" />}
          label="Messages Today"
          value={stats.messagesToday}
          subtext="SMS conversations"
        />
        <StatsCard
          icon={<Calendar className="w-8 h-8" />}
          label="Appointments Today"
          value={stats.appointmentsToday}
          subtext="Scheduled sessions"
        />
        <StatsCard
          icon={<Users className="w-8 h-8" />}
          label="New Patients This Week"
          value={stats.newPatientsThisWeek}
          subtext="Intake completed"
        />
      </div>

      {/* Recent calls section */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-bold text-gray-900">Recent Calls</h2>
          <a
            href="/dashboard/calls"
            className="text-teal-600 hover:text-teal-700 font-semibold text-sm"
          >
            View all →
          </a>
        </div>

        {loading ? (
          <div className="text-center py-8">
            <p className="text-gray-500">Loading...</p>
          </div>
        ) : recentCalls.length === 0 ? (
          <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
            <Phone className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-600">No calls yet</p>
          </div>
        ) : (
          <div className="space-y-3">
            {recentCalls.slice(0, 5).map((call) => (
              <CallCard key={call.id} call={call} />
            ))}
          </div>
        )}
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h3 className="font-semibold text-gray-900 mb-2">Configure Business Hours</h3>
          <p className="text-sm text-gray-600 mb-4">
            Set when your practice is open and when the AI should take messages
          </p>
          <a
            href="/dashboard/settings"
            className="text-teal-600 hover:text-teal-700 text-sm font-semibold"
          >
            Go to settings →
          </a>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h3 className="font-semibold text-gray-900 mb-2">View Patient Messages</h3>
          <p className="text-sm text-gray-600 mb-4">
            Check SMS conversations and respond to scheduling requests
          </p>
          <a
            href="/dashboard/messages"
            className="text-teal-600 hover:text-teal-700 text-sm font-semibold"
          >
            Go to messages →
          </a>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h3 className="font-semibold text-gray-900 mb-2">Review Call Transcripts</h3>
          <p className="text-sm text-gray-600 mb-4">
            Listen to AI interactions and read full transcripts
          </p>
          <a
            href="/dashboard/calls"
            className="text-teal-600 hover:text-teal-700 text-sm font-semibold"
          >
            Go to calls →
          </a>
        </div>
      </div>
    </div>
  )
}
