'use client'

import { useState, useEffect } from 'react'
import { Users, Clock, Phone, Star, AlertCircle, CheckCircle, RefreshCw } from 'lucide-react'

interface WaitlistPatient {
  id: string
  patient_name: string
  patient_phone: string
  patient_email?: string
  insurance_type: 'OHP' | 'private_pay' | 'unknown'
  session_type?: 'telehealth' | 'in_person' | 'either'
  reason?: string
  priority: 'high_need' | 'flexible' | 'standard'
  status: 'waiting' | 'fill_offered' | 'scheduled' | 'removed'
  created_at: string
  notes?: string
}

const PRIORITY_LABELS = {
  high_need: { label: 'High Need', color: 'bg-red-100 text-red-700', icon: AlertCircle },
  flexible: { label: 'Flexible', color: 'bg-blue-100 text-blue-700', icon: RefreshCw },
  standard: { label: 'Standard', color: 'bg-gray-100 text-gray-600', icon: Clock },
}

const STATUS_LABELS = {
  waiting: { label: 'Waiting', color: 'bg-yellow-100 text-yellow-700' },
  fill_offered: { label: 'Offer Sent', color: 'bg-purple-100 text-purple-700' },
  scheduled: { label: 'Scheduled', color: 'bg-green-100 text-green-700' },
  removed: { label: 'Removed', color: 'bg-gray-100 text-gray-400' },
}

export default function WaitlistPage() {
  const [patients, setPatients] = useState<WaitlistPatient[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'waiting' | 'fill_offered'>('waiting')
  const [priorityFilter, setPriorityFilter] = useState<'all' | 'high_need' | 'flexible' | 'standard'>('all')

  useEffect(() => {
    fetchWaitlist()
  }, [])

  async function fetchWaitlist() {
    setLoading(true)
    try {
      const res = await fetch('/api/waitlist')
      if (res.ok) {
        const data = await res.json()
        setPatients(data.patients || [])
      }
    } catch (err) {
      console.error('Error fetching waitlist:', err)
    } finally {
      setLoading(false)
    }
  }

  async function updatePriority(patientId: string, priority: WaitlistPatient['priority']) {
    await fetch(`/api/waitlist/${patientId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ priority }),
    })
    fetchWaitlist()
  }

  async function updateStatus(patientId: string, status: WaitlistPatient['status']) {
    await fetch(`/api/waitlist/${patientId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    fetchWaitlist()
  }

  const filteredPatients = patients.filter((p) => {
    if (filter !== 'all' && p.status !== filter) return false
    if (priorityFilter !== 'all' && p.priority !== priorityFilter) return false
    return true
  })

  const waitingCount = patients.filter((p) => p.status === 'waiting').length
  const highNeedCount = patients.filter((p) => p.priority === 'high_need' && p.status === 'waiting').length

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Waitlist</h1>
        <p className="text-gray-500 mt-1">
          {waitingCount} patient{waitingCount !== 1 ? 's' : ''} waiting
          {highNeedCount > 0 && (
            <span className="ml-2 text-red-600 font-medium">· {highNeedCount} high need</span>
          )}
        </p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm">
          <div className="flex items-center gap-2 text-gray-500 text-sm mb-1">
            <Users className="w-4 h-4" />
            Total Waiting
          </div>
          <div className="text-2xl font-bold text-gray-900">{waitingCount}</div>
        </div>
        <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm">
          <div className="flex items-center gap-2 text-red-500 text-sm mb-1">
            <AlertCircle className="w-4 h-4" />
            High Need
          </div>
          <div className="text-2xl font-bold text-gray-900">{highNeedCount}</div>
        </div>
        <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm">
          <div className="flex items-center gap-2 text-blue-500 text-sm mb-1">
            <RefreshCw className="w-4 h-4" />
            Flexible
          </div>
          <div className="text-2xl font-bold text-gray-900">
            {patients.filter((p) => p.priority === 'flexible' && p.status === 'waiting').length}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-4">
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          {(['waiting', 'fill_offered', 'all'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                filter === s ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {s === 'all' ? 'All' : s === 'fill_offered' ? 'Offer Sent' : 'Waiting'}
            </button>
          ))}
        </div>

        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          {(['all', 'high_need', 'flexible', 'standard'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPriorityFilter(p)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                priorityFilter === p ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {p === 'all' ? 'All Priority' : p === 'high_need' ? 'High Need' : p.charAt(0).toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Patient list */}
      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading waitlist...</div>
      ) : filteredPatients.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl border border-gray-100">
          <Users className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">No patients match this filter</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredPatients.map((patient) => {
            const priorityMeta = PRIORITY_LABELS[patient.priority]
            const statusMeta = STATUS_LABELS[patient.status]
            const PriorityIcon = priorityMeta.icon
            const waitDays = Math.floor(
              (Date.now() - new Date(patient.created_at).getTime()) / (1000 * 60 * 60 * 24)
            )

            return (
              <div key={patient.id} className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-gray-900">{patient.patient_name}</span>
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${priorityMeta.color}`}>
                        <PriorityIcon className="w-3 h-3" />
                        {priorityMeta.label}
                      </span>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusMeta.color}`}>
                        {statusMeta.label}
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-3 text-sm text-gray-500">
                      <span className="flex items-center gap-1">
                        <Phone className="w-3.5 h-3.5" />
                        {patient.patient_phone}
                      </span>
                      {patient.insurance_type && (
                        <span className="capitalize">
                          {patient.insurance_type === 'OHP' ? 'OHP' :
                           patient.insurance_type === 'private_pay' ? 'Private Pay' : 'Unknown Insurance'}
                        </span>
                      )}
                      {patient.session_type && (
                        <span className="capitalize">
                          {patient.session_type === 'in_person' ? 'In Person' :
                           patient.session_type === 'telehealth' ? 'Telehealth' : 'Either'}
                        </span>
                      )}
                      <span className="flex items-center gap-1 text-gray-400">
                        <Clock className="w-3.5 h-3.5" />
                        {waitDays === 0 ? 'Today' : `${waitDays}d ago`}
                      </span>
                    </div>

                    {patient.reason && (
                      <p className="text-sm text-gray-600 mt-2 italic">"{patient.reason}"</p>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex flex-col gap-2 shrink-0">
                    {patient.status === 'waiting' && (
                      <button
                        onClick={() => updateStatus(patient.id, 'scheduled')}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-green-50 text-green-700 rounded-lg text-xs font-medium hover:bg-green-100 transition-colors"
                      >
                        <CheckCircle className="w-3.5 h-3.5" />
                        Mark Scheduled
                      </button>
                    )}

                    <select
                      value={patient.priority}
                      onChange={(e) => updatePriority(patient.id, e.target.value as WaitlistPatient['priority'])}
                      className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 text-gray-600 bg-white"
                    >
                      <option value="high_need">High Need</option>
                      <option value="flexible">Flexible</option>
                      <option value="standard">Standard</option>
                    </select>

                    <button
                      onClick={() => updateStatus(patient.id, 'removed')}
                      className="text-xs text-gray-400 hover:text-red-500 transition-colors py-1"
                    >
                      Remove
                    </button>
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
