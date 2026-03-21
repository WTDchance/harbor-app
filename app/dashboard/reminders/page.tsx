'use client'

import { useEffect, useState } from 'react'
import { Bell, CheckCircle, AlertCircle, Loader } from 'lucide-react'
import { createClient } from '@/lib/supabase-browser'

interface Reminder {
  id: string
  patient_name: string | null
  patient_phone: string
  appointment_time: string | null
  session_type: string
  status: string
  created_at: string
  reply_received_at: string | null
}

export default function RemindersPage() {
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [practice, setPractice] = useState<any>(null)
  const [form, setForm] = useState({
    patient_name: '',
    patient_phone: '',
    appointment_time: '',
    session_type: 'in-person',
  })
  const supabase = createClient()

  useEffect(() => {
    const loadData = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        setLoading(false)
        return
      }

      const { data: practiceData } = await supabase
        .from('practices')
        .select('id')
        .eq('notification_email', user.email)
        .single()

      if (practiceData) {
        setPractice(practiceData)

        // Fetch reminders
        const { data: remindersData } = await supabase
          .from('appointment_reminders')
          .select('*')
          .eq('practice_id', practiceData.id)
          .order('created_at', { ascending: false })
          .limit(50)

        if (remindersData) {
          setReminders(remindersData)
        }
      }

      setLoading(false)
    }

    loadData()
  }, [supabase])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!practice) return

    setSubmitting(true)
    try {
      const res = await fetch('/api/reminders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          practice_id: practice.id,
          patient_name: form.patient_name,
          patient_phone: form.patient_phone,
          appointment_time: form.appointment_time,
          session_type: form.session_type,
        }),
      })

      if (res.ok) {
        // Refresh reminders list
        const { data: remindersData } = await supabase
          .from('appointment_reminders')
          .select('*')
          .eq('practice_id', practice.id)
          .order('created_at', { ascending: false })
          .limit(50)

        if (remindersData) {
          setReminders(remindersData)
        }

        // Reset form
        setForm({
          patient_name: '',
          patient_phone: '',
          appointment_time: '',
          session_type: 'in-person',
        })

        alert('Reminder sent successfully!')
      } else {
        alert('Failed to send reminder')
      }
    } catch (error) {
      console.error('Error:', error)
      alert('Error sending reminder')
    }
    setSubmitting(false)
  }

  const formatTime = (isoString: string | null) => {
    if (!isoString) return '—'
    return new Date(isoString).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  }

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
        <h1 className="text-2xl font-bold text-gray-900">Appointment Reminders</h1>
        <p className="text-gray-500 mt-1">Send and track patient reminders</p>
      </div>

      {/* Send reminder form */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-8">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Send a Reminder</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Patient Name</label>
              <input
                type="text"
                value={form.patient_name}
                onChange={e => setForm(f => ({ ...f, patient_name: e.target.value }))}
                placeholder="John Smith"
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Patient Phone</label>
              <input
                type="tel"
                value={form.patient_phone}
                onChange={e => setForm(f => ({ ...f, patient_phone: e.target.value }))}
                placeholder="+1 (555) 000-0000"
                required
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Appointment Date & Time</label>
              <input
                type="datetime-local"
                value={form.appointment_time}
                onChange={e => setForm(f => ({ ...f, appointment_time: e.target.value }))}
                required
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Session Type</label>
              <select
                value={form.session_type}
                onChange={e => setForm(f => ({ ...f, session_type: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              >
                <option value="in-person">In-Person</option>
                <option value="telehealth">Telehealth</option>
              </select>
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting || !form.patient_phone || !form.appointment_time}
            className="w-full bg-teal-600 text-white py-2.5 rounded-lg font-medium hover:bg-teal-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
          >
            {submitting ? (
              <>
                <Loader className="w-4 h-4 animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <Bell className="w-4 h-4" />
                Send Reminder
              </>
            )}
          </button>
        </form>
      </div>

      {/* Recent reminders */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Recent Reminders</h2>
        </div>

        {reminders.length === 0 ? (
          <div className="p-12 text-center">
            <Bell className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500">No reminders sent yet</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-600">Patient</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-600">Phone</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-600">Appointment</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-600">Type</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-600">Sent</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-600">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {reminders.map(reminder => (
                  <tr key={reminder.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-4 font-medium text-gray-900">
                      {reminder.patient_name || '—'}
                    </td>
                    <td className="px-5 py-4 text-sm text-gray-600 font-mono">
                      {reminder.patient_phone}
                    </td>
                    <td className="px-5 py-4 text-sm text-gray-600">
                      {formatTime(reminder.appointment_time)}
                    </td>
                    <td className="px-5 py-4 text-sm text-gray-600">
                      {reminder.session_type === 'in-person' ? 'In-Person' : 'Telehealth'}
                    </td>
                    <td className="px-5 py-4 text-xs text-gray-500">
                      {new Date(reminder.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        {reminder.reply_received_at ? (
                          <>
                            <CheckCircle className="w-4 h-4 text-green-600" />
                            <span className="text-xs font-medium text-green-700">Replied</span>
                          </>
                        ) : reminder.status === 'sent' ? (
                          <>
                            <AlertCircle className="w-4 h-4 text-blue-600" />
                            <span className="text-xs font-medium text-blue-700">Sent</span>
                          </>
                        ) : (
                          <span className="text-xs font-medium text-gray-700">{reminder.status}</span>
                        )}
                      </div>
                    </td>
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
