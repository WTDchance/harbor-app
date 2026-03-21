'use client'

import { useState, useEffect } from 'react'
import { Search, Phone } from 'lucide-react'
import { CallCard } from '@/components/CallCard'
import type { CallLog } from '@/types'

export default function CallsPage() {
  const [calls, setCalls] = useState<CallLog[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Fetch call logs
    const fetchCalls = async () => {
      try {
        // Mock data for demo
        setCalls([
          {
            id: 'call-001',
            practice_id: 'practice-001',
            patient_phone: '+15551112222',
            duration_seconds: 447,
            transcript:
              "Sam: Good afternoon, this is Sam with Hope and Harmony Counseling. How can I help you today?\nCaller: Hi, I'm looking to schedule an appointment with someone who specializes in anxiety.\nSam: Of course! I'd be happy to help.",
            summary: 'New patient intake: Alex Turner, anxiety concerns, scheduled for Thursday 2 PM',
            vapi_call_id: 'call_demo_001',
            created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
          },
          {
            id: 'call-002',
            practice_id: 'practice-001',
            patient_phone: '+15551113333',
            duration_seconds: 312,
            transcript:
              "Sam: Good afternoon, this is Sam with Hope and Harmony. How can I help?\nCaller: Hi, I need to reschedule my appointment for next week.",
            summary: 'Appointment rescheduling: existing patient',
            vapi_call_id: 'call_demo_002',
            created_at: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
          },
        ])
      } catch (error) {
        console.error('Error fetching calls:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchCalls()
  }, [])

  const filteredCalls = calls.filter((call) =>
    call.patient_phone.includes(search) || call.summary?.includes(search)
  )

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Call Logs</h1>
        <p className="text-gray-600 mt-2">All inbound calls handled by your AI receptionist</p>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
        <input
          type="text"
          placeholder="Search by phone number or summary..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-600 focus:border-transparent"
        />
      </div>

      {/* Call list */}
      {loading ? (
        <div className="text-center py-8">
          <p className="text-gray-500">Loading calls...</p>
        </div>
      ) : filteredCalls.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
          <Phone className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-600">No calls found</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredCalls.map((call) => (
            <CallCard key={call.id} call={call} />
          ))}
        </div>
      )}

      {/* Stats footer */}
      {filteredCalls.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-4 text-sm text-gray-600">
          Showing {filteredCalls.length} of {calls.length} calls
        </div>
      )}
    </div>
  )
}
