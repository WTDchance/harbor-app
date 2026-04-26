'use client'

// Wave 21: supabase-browser is now a no-op stub (returns empty arrays).
// Pages still call supabase.from() against it; full rewrite to AWS API
// fetches lands in Wave 23. Auth redirects are gone — pages render empty.
import { createClient } from '@/lib/supabase-browser'
const supabase = createClient()

import { useState, useEffect } from 'react'
import { Phone, Users, AlertTriangle, Clock, CheckCircle, Edit2, Save, X, Eye } from 'lucide-react'

interface Practice {
  id: string
  name: string
  ai_name: string
  phone_number: string
  timezone: string
  insurance_accepted: string[]
  hours_json: any
  notification_emails: string[]
  created_at: string
  updated_at: string
}

interface CallLog {
  id: string
  patient_phone: string
  duration_seconds: number
  created_at: string
  summary: string
}

interface WaitlistEntry {
  id: string
  name: string
  phone: string
  created_at: string
}

export default function PracticeDetailPage({ params }: { params: { id: string } }) {
  const [practice, setPractice] = useState<Practice | null>(null)
  const [contactEmail, setContactEmail] = useState<string>('')
  const [callLogs, setCallLogs] = useState<CallLog[]>([])
  const [waitlist, setWaitlist] = useState<WaitlistEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)

  const [editName, setEditName] = useState('')
  const [editAiName, setEditAiName] = useState('')
  const [editPhone, setEditPhone] = useState('')
  const [editTimezone, setEditTimezone] = useState('')
  const [editInsurance, setEditInsurance] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [editNotificationEmails, setEditNotificationEmails] = useState('')


  useEffect(() => {
    loadData()
  }, [params.id])

  async function loadData() {
    setLoading(true)

    const { data: practiceData } = await supabase
      .from('practices')
      .select('*')
      .eq('id', params.id)
      .single()

    if (practiceData) setPractice(practiceData)

    const { data: userData } = await supabase
      .from('users')
      .select('email')
      .eq('practice_id', params.id)
      .single()

    if (userData) setContactEmail(userData.email)

    const { data: logs } = await supabase
      .from('call_logs')
      .select('*')
      .eq('practice_id', params.id)
      .order('created_at', { ascending: false })
      .limit(10)

    if (logs) setCallLogs(logs)

    const { data: waitlistData } = await supabase
      .from('waitlist')
      .select('*')
      .eq('practice_id', params.id)
      .order('created_at', { ascending: false })
      .limit(10)

    if (waitlistData) setWaitlist(waitlistData)

    setLoading(false)
  }

  function startEditing() {
    if (!practice) return
    setEditName(practice.name || '')
    setEditAiName(practice.ai_name || '')
    setEditPhone(practice.phone_number || '')
    setEditTimezone(practice.timezone || '')
    setEditInsurance(
      Array.isArray(practice.insurance_accepted)
        ? practice.insurance_accepted.join(', ')
        : practice.insurance_accepted || ''
    )
    setEditEmail(contactEmail || '')
    setEditNotificationEmails(
      Array.isArray(practice.notification_emails) && practice.notification_emails.length > 0
        ? practice.notification_emails.join(', ')
        : ''
    )
    setEditing(true)
    setSaveError(null)
    setSaveSuccess(false)
  }

  function cancelEditing() {
    setEditing(false)
    setSaveError(null)
  }

  async function saveChanges() {
    if (!practice) return
    setSaving(true)
    setSaveError(null)

    const insuranceArray = editInsurance
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)

    const { error: practiceError } = await supabase
      .from('practices')
      .update({
        name: editName,
        ai_name: editAiName,
        phone_number: editPhone,
        timezone: editTimezone,
        insurance_accepted: insuranceArray,
        notification_emails: editNotificationEmails
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        updated_at: new Date().toISOString(),
      })
      .eq('id', practice.id)

    if (practiceError) {
      setSaveError('Failed to update practice: ' + practiceError.message)
      setSaving(false)
      return
    }

    if (editEmail !== contactEmail) {
      const { error: userError } = await supabase
        .from('users')
        .update({ email: editEmail })
        .eq('practice_id', practice.id)

      if (userError) {
        setSaveError('Practice updated but failed to update email: ' + userError.message)
        setSaving(false)
        return
      }
    }

    await loadData()
    setEditing(false)
    setSaving(false)
    setSaveSuccess(true)
    setTimeout(() => setSaveSuccess(false), 3000)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  if (!practice) {
    return (
      <div className="p-8 text-center text-gray-500">
        Practice not found.
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{practice.name}</h1>
          <p className="text-sm text-gray-500 mt-1">Practice ID: {practice.id}</p>
        </div>
        {!editing ? (
          <div className="flex gap-2">
            <button
              onClick={async () => {
                // Wave 21: Cognito session cookie auto-attached on same-origin fetch.
                const res = await fetch('/api/admin/act-as', {
                  method: 'POST',
                  headers: {
                                        'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({ practiceId: practice.id }),
                })
                if (res.ok) window.location.href = '/dashboard'
                else alert('Failed to enter admin view')
              }}
              className="flex items-center gap-2 px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors"
              title="Open this practice's dashboard as admin"
            >
              <Eye className="h-4 w-4" />
              View Dashboard
            </button>
            <button
              onClick={startEditing}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Edit2 className="h-4 w-4" />
              Edit Practice
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            <button
              onClick={cancelEditing}
              className="flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
            >
              <X className="h-4 w-4" />
              Cancel
            </button>
            <button
              onClick={saveChanges}
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        )}
      </div>

      {saveError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          {saveError}
        </div>
      )}

      {saveSuccess && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-green-700 flex items-center gap-2">
          <CheckCircle className="h-4 w-4 flex-shrink-0" />
          Practice updated successfully!
        </div>
      )}

      {/* Practice Details Card */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Practice Details</h2>

        {!editing ? (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-gray-500">Practice Name</p>
              <p className="font-medium text-gray-900">{practice.name}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">AI Assistant Name</p>
              <p className="font-medium text-gray-900">{practice.ai_name || '—'}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Phone Number</p>
              <p className="font-medium text-gray-900">{practice.phone_number || '—'}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Contact Email</p>
              <p className="font-medium text-gray-900">{contactEmail || '—'}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Timezone</p>
              <p className="font-medium text-gray-900">{practice.timezone || '—'}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Insurance Accepted</p>
              <p className="font-medium text-gray-900">
                {Array.isArray(practice.insurance_accepted) && practice.insurance_accepted.length > 0
                  ? practice.insurance_accepted.join(', ')
                  : '—'}
              </p>
            </div>
            <div className="col-span-2">
              <p className="text-sm text-gray-500">Additional Notification Emails</p>
              <p className="font-medium text-gray-900">
                {Array.isArray(practice.notification_emails) && practice.notification_emails.length > 0
                  ? practice.notification_emails.join(', ')
                  : 'None set'}
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Member Since</p>
              <p className="font-medium text-gray-900">
                {new Date(practice.created_at).toLocaleDateString()}
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Practice Name</label>
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">AI Assistant Name</label>
              <input
                type="text"
                value={editAiName}
                onChange={(e) => setEditAiName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number</label>
              <input
                type="text"
                value={editPhone}
                onChange={(e) => setEditPhone(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Contact Email</label>
              <input
                type="email"
                value={editEmail}
                onChange={(e) => setEditEmail(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Timezone</label>
              <select
                value={editTimezone}
                onChange={(e) => setEditTimezone(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select timezone...</option>
                <option value="America/New_York">Eastern Time</option>
                <option value="America/Chicago">Central Time</option>
                <option value="America/Denver">Mountain Time</option>
                <option value="America/Los_Angeles">Pacific Time</option>
                <option value="America/Anchorage">Alaska Time</option>
                <option value="Pacific/Honolulu">Hawaii Time</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Insurance Accepted <span className="text-gray-400 font-normal">(comma-separated)</span>
              </label>
              <input
                type="text"
                value={editInsurance}
                onChange={(e) => setEditInsurance(e.target.value)}
                placeholder="Aetna, Blue Cross, Cigna..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Additional Notification Emails <span className="text-gray-400 font-normal">(comma-separated — everyone gets call summaries)</span>
              </label>
              <input
                type="text"
                value={editNotificationEmails}
                onChange={(e) => setEditNotificationEmails(e.target.value)}
                placeholder="dr.trace@email.com, office@practice.com..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        )}
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-2 text-blue-600 mb-2">
            <Phone className="h-5 w-5" />
            <span className="font-semibold">Total Calls</span>
          </div>
          <p className="text-3xl font-bold text-gray-900">{callLogs.length}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-2 text-purple-600 mb-2">
            <Users className="h-5 w-5" />
            <span className="font-semibold">Waitlist</span>
          </div>
          <p className="text-3xl font-bold text-gray-900">{waitlist.length}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-2 text-green-600 mb-2">
            <CheckCircle className="h-5 w-5" />
            <span className="font-semibold">Status</span>
          </div>
          <p className="text-lg font-bold text-green-600">Active</p>
        </div>
      </div>

      {/* Recent Calls */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Recent Calls</h2>
        {callLogs.length === 0 ? (
          <p className="text-gray-500 text-sm">No calls recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 text-gray-500 font-medium">Patient</th>
                  <th className="text-left py-2 text-gray-500 font-medium">Duration</th>
                  <th className="text-left py-2 text-gray-500 font-medium">Date</th>
                  <th className="text-left py-2 text-gray-500 font-medium">Summary</th>
                </tr>
              </thead>
              <tbody>
                {callLogs.map((log) => (
                  <tr key={log.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-3 font-medium text-gray-900">{log.patient_phone}</td>
                    <td className="py-3 text-gray-600">
                      {log.duration_seconds
                        ? `${Math.floor(log.duration_seconds / 60)}m ${log.duration_seconds % 60}s`
                        : '—'}
                    </td>
                    <td className="py-3 text-gray-600">
                      {new Date(log.created_at).toLocaleDateString()}
                    </td>
                    <td className="py-3 text-gray-500 text-xs max-w-xs truncate">
                      {log.summary || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Waitlist */}
      {waitlist.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Waitlist</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 text-gray-500 font-medium">Name</th>
                  <th className="text-left py-2 text-gray-500 font-medium">Phone</th>
                  <th className="text-left py-2 text-gray-500 font-medium">Date Added</th>
                </tr>
              </thead>
              <tbody>
                {waitlist.map((entry) => (
                  <tr key={entry.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-3 font-medium text-gray-900">{entry.name}</td>
                    <td className="py-3 text-gray-600">{entry.phone}</td>
                    <td className="py-3 text-gray-600">
                      {new Date(entry.created_at).toLocaleDateString()}
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
