'use client'

import { useState, useEffect } from 'react'
import { Phone, Users, AlertTriangle, Clock, CheckCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase-browser'

interface Practice {
  id: string
  name: string
  therapist_name: string
  therapist_phone: string
  phone_number: string
  notification_email: string
  vapi_assistant_id: string
  created_at: string
}

interface CallLog {
  id: string
  patient_phone: string
  duration_seconds: number
  created_at: string
  crisis_detected?: boolean
  summary?: string
}

interface WaitlistItem {
  id: string
  patient_name: string
  patient_phone: string
  status: string
  priority: number
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

export default function PracticeDetailPage({ params }: { params: { id: string } }) {
  const [practice, setPractice] = useState<Practice | null>(null)
  const [calls, setCalls] = useState<CallLog[]>([])
  const [waitlist, setWaitlist] = useState<WaitlistItem[]>([])
  const [loading, setLoading] = useState(true)
  const [testSending, setTestSending] = useState(false)
  const supabase = createClient()

  useEffect(() => {
    const fetchData = async () => {
      const { data: practiceData } = await supabase
        .from('practices')
        .select('*')
        .eq('id', params.id)
        .single()

      if (practiceData) {
        setPractice(practiceData)

        const { data: callsData } = await supabase
          .from('call_logs')
          .select('*')
          .eq('practice_id', params.id)
          .order('created_at', { ascending: false })
          .limit(10)

        setCalls(callsData || [])

        const { data: waitlistData } = await supabase
          .from('waitlist')
          .select('*')
          .eq('practice_id', params.id)
          .order('created_at', { ascending: false })

        setWaitlist(waitlistData || [])
      }

      setLoading(false)
    }

    fetchData()
  }, [params.id, supabase])

  const crisisCount = calls.filter(c => c.crisis_detected).length
  const waitingCount = waitlist.filter(w => w.status === 'waiting').length

  const handleTestCrisisSMS = async () => {
    if (!practice?.therapist_phone) {
      alert('No therapist phone number configured')
      return
    }

    setTestSending(true)
    try {
      const res = await fetch('/api/test-crisis-sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          practice_id: params.id,
          phone: practice.therapist_phone,
        }),
      })

      if (res.ok) {
        alert('Test crisis SMS sent!')
      } else {
        alert('Failed to send test SMS')
      }
    } catch (error) {
      console.error(error)
      alert('Error sending test SMS')
    }
    setTestSending(false)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40">
        <div className="w-6 h-6 border-2 border-teal-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!practice) {
    return <div className="text-center text-gray-500">Practice not found</div>
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{practice.name}</h1>
        <p className="text-gray-500 mt-1">{practice.therapist_name}</p>
      </div>

      <div className="flex gap-2">
        <span className={`inline-flex items-center px-3 py-1.5 rounded-lg text-sm font-medium ${
          practice.vapi_assistant_id
            ? 'bg-green-100 text-green-700'
            : 'bg-yellow-100 text-yellow-700'
        }`}>
          {practice.vapi_assistant_id ? 'Live' : 'Setup needed'}
        </span>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-sm text-gray-500">Total Calls</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{calls.length}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-sm text-gray-500">Crisis Alerts</p>
          <p className="text-2xl font-bold text-red-600 mt-1">{crisisCount}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-sm text-gray-500">Waitlist</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{waitingCount}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-sm text-gray-500">Setup Date</p>
          <p className="text-sm font-medium text-gray-900 mt-1">{new Date(practice.created_at).toLocaleDateString()}</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <h2 className="font-semibold text-gray-900 mb-3">Contact Information</h2>
        <div className="space-y-2 text-sm">
          <div><span className="text-gray-500">Email:</span> <span className="font-medium">{practice.notification_email}</span></div>
          <div><span className="text-gray-500">Phone:</span> <span className="font-medium">{practice.therapist_phone || 'Not set'}</span></div>
          <div><span className="text-gray-500">Practice phone:</span> <span className="font-medium">{practice.phone_number || 'Not set'}</span></div>
          <div><span className="text-gray-500">Vapi ID:</span> <span className="font-mono text-xs">{practice.vapi_assistant_id || 'Not set'}</span></div>
        </div>
      </div>

      <div className="bg-red-50 border border-red-200 rounded-xl p-4">
        <h2 className="font-semibold text-red-900 mb-3">Test Actions</h2>
        <button
          onClick={handleTestCrisisSMS}
          disabled={testSending || !practice.therapist_phone}
          className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
        >
          {testSending ? 'Sending...' : '🚨 Send Test Crisis SMS'}
        </button>
      </div>

      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Recent Calls (Last 10)</h2>
        {calls.length === 0 ? (
          <div className="bg-white rounded-xl border border-dashed border-gray-300 p-8 text-center">
            <Phone className="w-10 h-10 text-gray-300 mx-auto mb-2" />
            <p className="text-gray-500">No calls yet</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left font-semibold text-gray-700">Caller</th>
                  <th className="px-6 py-3 text-left font-semibold text-gray-700">Duration</th>
                  <th className="px-6 py-3 text-left font-semibold text-gray-700">Time</th>
                  <th className="px-6 py-3 text-left font-semibold text-gray-700">Crisis?</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {calls.map(call => (
                  <tr key={call.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 text-gray-900">{call.patient_phone}</td>
                    <td className="px-6 py-4 text-gray-600">{formatDuration(call.duration_seconds)}</td>
                    <td className="px-6 py-4 text-gray-600">{timeAgo(call.created_at)}</td>
                    <td className="px-6 py-4">
                      {call.crisis_detected ? (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs bg-red-100 text-red-700">
                          <AlertTriangle className="w-3 h-3" />
                          Yes
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
        )}
      </div>

      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Waitlist</h2>
        {waitlist.length === 0 ? (
          <div className="bg-white rounded-xl border border-dashed border-gray-300 p-8 text-center">
            <Users className="w-10 h-10 text-gray-300 mx-auto mb-2" />
            <p className="text-gray-500">No waitlist patients</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left font-semibold text-gray-700">Patient</th>
                  <th className="px-6 py-3 text-left font-semibold text-gray-700">Phone</th>
                  <th className="px-6 py-3 text-left font-semibold text-gray-700">Status</th>
                  <th className="px-6 py-3 text-left font-semibold text-gray-700">Priority</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {waitlist.map(item => (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 font-medium text-gray-900">{item.patient_name}</td>
                    <td className="px-6 py-4 text-gray-600">{item.patient_phone}</td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${
                        item.status === 'waiting'
                          ? 'bg-blue-100 text-blue-700'
                          : item.status === 'scheduled'
                          ? 'bg-green-100 text-green-700'
                          : 'bg-gray-100 text-gray-700'
                      }`}>
                        {item.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-gray-600">{item.priority}</td>
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
