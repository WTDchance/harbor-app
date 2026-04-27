'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { CalendarDays, Plus, ChevronLeft, ChevronRight, Clock, Phone, User, CheckCircle, XCircle, AlertCircle, FileText } from 'lucide-react'
import { TelehealthButton } from '@/components/ehr/TelehealthButton'
import { SessionTimerButton } from '@/components/ehr/SessionTimerButton'
import { RecurrencePicker } from '@/components/ehr/RecurrencePicker'

interface Appointment {
  id: string
  patient_name: string
  patient_phone: string
  patient_email: string | null
  appointment_date: string
  appointment_time: string
  duration_minutes: number
  appointment_type: string
  status: string
  notes: string
  reminder_sent: boolean
}

const STATUS_COLORS: Record<string, string> = {
  scheduled: 'bg-blue-100 text-blue-800',
  confirmed: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
  completed: 'bg-gray-100 text-gray-800',
  no_show: 'bg-yellow-100 text-yellow-800',
}

function getWeekDates(offset: number) {
  const now = new Date()
  const day = now.getDay()
  const monday = new Date(now)
  monday.setDate(now.getDate() - day + 1 + offset * 7)
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    return d
  })
}

export default function AppointmentsPage() {
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [loading, setLoading] = useState(true)
  const [weekOffset, setWeekOffset] = useState(0)
  const [showModal, setShowModal] = useState(false)
  const [selectedAppt, setSelectedAppt] = useState<Appointment | null>(null)
  const [form, setForm] = useState({
    patient_name: '',
    patient_phone: '',
    patient_email: '',
    appointment_date: new Date().toISOString().split('T')[0],
    appointment_time: '09:00',
    duration_minutes: 50,
    appointment_type: 'in-person',
    notes: '',
    // Wave 38 TS1
    recurrence: 'none',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [sendingIntake, setSendingIntake] = useState<string | null>(null)
  const [intakeSentMap, setIntakeSentMap] = useState<Record<string, 'sms' | 'email' | 'both'>>({})
  const [intakeModal, setIntakeModal] = useState<Appointment | null>(null)
  const [intakePhone, setIntakePhone] = useState('')
  const [intakeEmail, setIntakeEmail] = useState('')

  const weekDates = getWeekDates(weekOffset)
  const weekStart = weekDates[0].toISOString().split('T')[0]
  const weekEnd = weekDates[6].toISOString().split('T')[0]

  useEffect(() => {
    fetchAppointments()
  }, [weekOffset])

  // Auto-refresh every 2 minutes
  useEffect(() => {
    const interval = setInterval(fetchAppointments, 120000)
    return () => clearInterval(interval)
  }, [weekOffset])

  async function fetchAppointments() {
    setLoading(true)
    try {
      const r = await fetch(`/api/appointments?week_start=${weekStart}&week_end=${weekEnd}`)
      const d = await r.json()
      setAppointments(d.appointments || [])
    } catch {
      setError('Failed to load appointments')
    } finally {
      setLoading(false)
    }
  }

  async function handleSave() {
    setSaving(true)
    setError('')
    try {
      // Conflict pre-check — warn (don't block) if the proposed slot
      // overlaps with another scheduled/confirmed appointment.
      try {
        const params = new URLSearchParams({
          date: form.appointment_date,
          time: form.appointment_time,
          duration: String(form.duration_minutes || 45),
        })
        if (selectedAppt?.id) params.set('exclude_id', selectedAppt.id)
        const cr = await fetch(`/api/ehr/appointments/conflicts?${params.toString()}`)
        if (cr.ok) {
          const j = await cr.json()
          if (j.conflicts && j.conflicts.length > 0) {
            const list = j.conflicts.map((c: any) =>
              `${c.time} · ${c.patient_name} (${c.duration_minutes} min, ${c.status})`
            ).join('\n')
            if (!confirm(
              `This overlaps with:\n\n${list}\n\nBook anyway?`
            )) { setSaving(false); return }
          }
        }
      } catch {
        // Non-fatal — continue with save if the conflict check itself fails.
      }

      const method = selectedAppt ? 'PATCH' : 'POST'
      const body: any = selectedAppt ? { id: selectedAppt.id, ...form } : { ...form }
      // TS1 — only the create path materializes a series; on edit we
      // route through PATCH /api/ehr/appointments/[id] with a scope.
      if (!selectedAppt && form.recurrence && form.recurrence !== 'none') {
        body.recurrence = form.recurrence
      }
      const r = await fetch('/api/appointments', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!r.ok) {
        const d = await r.json()
        throw new Error(d.error || 'Failed to save')
      }
      setShowModal(false)
      setSelectedAppt(null)
      resetForm()
      fetchAppointments()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleCancel(id: string) {
    if (!confirm('Cancel this appointment?')) return
    await fetch('/api/appointments', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    fetchAppointments()
  }

  async function handleStatusChange(id: string, status: string) {
    await fetch('/api/appointments', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status }),
    })
    fetchAppointments()
  }

  function resetForm() {
    setForm({
      patient_name: '',
      patient_phone: '',
      appointment_date: new Date().toISOString().split('T')[0],
      appointment_time: '09:00',
      duration_minutes: 50,
      appointment_type: 'in-person',
      notes: '',
    })
  }

  function openEdit(appt: Appointment) {
    setSelectedAppt(appt)
    setForm({
      patient_name: appt.patient_name,
      patient_phone: appt.patient_phone || '',
      appointment_date: appt.appointment_date,
      appointment_time: appt.appointment_time.slice(0, 5),
      duration_minutes: appt.duration_minutes,
      appointment_type: appt.appointment_type,
      notes: appt.notes || '',
    })
    setShowModal(true)
  }

  const stats = {
    total: appointments.length,
    confirmed: appointments.filter(a => a.status === 'confirmed').length,
    pending: appointments.filter(a => a.status === 'scheduled').length,
    cancelled: appointments.filter(a => a.status === 'cancelled').length,
  }

  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

  return (
  <>
      <main className="flex-1 p-8">
        <div className="max-w-6xl mx-auto">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <CalendarDays className="w-8 h-8 text-teal-600" />
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Appointments</h1>
                <p className="text-sm text-gray-500">Schedule and manage patient appointments</p>
              </div>
            </div>
            <button
              onClick={() => { resetForm(); setSelectedAppt(null); setShowModal(true) }}
              className="flex items-center gap-2 bg-teal-600 text-white px-4 py-2 rounded-lg hover:bg-teal-700 transition-colors"
            >
              <Plus className="w-4 h-4" />
              New Appointment
            </button>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-4 gap-4 mb-6">
            {[
              { label: 'This Week', value: stats.total, color: 'text-gray-900' },
              { label: 'Confirmed', value: stats.confirmed, color: 'text-green-600' },
              { label: 'Pending', value: stats.pending, color: 'text-blue-600' },
              { label: 'Cancelled', value: stats.cancelled, color: 'text-red-600' },
            ].map(s => (
              <div key={s.label} className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
                <p className="text-sm text-gray-500">{s.label}</p>
                <p className={`text-3xl font-bold ${s.color}`}>{s.value}</p>
              </div>
            ))}
          </div>

          {/* Week Nav */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden mb-6">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <button onClick={() => setWeekOffset(w => w - 1)} className="p-2 hover:bg-gray-100 rounded-lg">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <div className="text-center">
                <h2 className="font-semibold text-gray-900">
                  {weekDates[0].toLocaleDateString('en-US', { month: 'long', day: 'numeric' })} – {weekDates[6].toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                </h2>
                {weekOffset === 0 && <span className="text-xs text-teal-600 font-medium">Current Week</span>}
              </div>
              <button onClick={() => setWeekOffset(w => w + 1)} className="p-2 hover:bg-gray-100 rounded-lg">
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            {/* Day Columns */}
            <div className="grid grid-cols-7 divide-x divide-gray-100">
              {weekDates.map((date, i) => {
                const dateStr = date.toISOString().split('T')[0]
                const dayAppts = appointments.filter(a => a.appointment_date === dateStr).sort((a, b) => a.appointment_time.localeCompare(b.appointment_time))
                const isToday = dateStr === new Date().toISOString().split('T')[0]
                return (
                  <div key={dateStr} className="min-h-[180px] p-2">
                    <div className={`text-center mb-2 ${isToday ? 'text-teal-600 font-bold' : 'text-gray-500'}`}>
                      <p className="text-xs uppercase tracking-wide">{DAYS[i]}</p>
                      <p className={`text-lg font-semibold ${isToday ? 'bg-teal-600 text-white w-8 h-8 rounded-full flex items-center justify-center mx-auto' : ''}`}>
                        {date.getDate()}
                      </p>
                    </div>
                    <div className="space-y-1">
                      {dayAppts.map(appt => (
                        <div
                          key={appt.id}
                          onClick={() => openEdit(appt)}
                          className={`p-1.5 rounded-lg cursor-pointer hover:opacity-80 transition-opacity text-xs ${STATUS_COLORS[appt.status] || 'bg-gray-100 text-gray-800'}`}
                        >
                          <p className="font-medium truncate">{appt.appointment_time.slice(0,5)}</p>
                          <p className="truncate">{appt.patient_name}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* List View */}
          {loading ? (
            <div className="text-center py-8 text-gray-400">Loading...</div>
          ) : appointments.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <CalendarDays className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>No appointments this week</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase">Patient</th>
                    <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase">Date & Time</th>
                    <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase">Type</th>
                    <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase">Status</th>
                    <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase">Reminder</th>
                    <th className="text-right py-3 px-4 text-xs font-medium text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {appointments.map(appt => (
                    <tr key={appt.id} className="hover:bg-gray-50">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-full bg-teal-100 flex items-center justify-center">
                            <User className="w-4 h-4 text-teal-600" />
                          </div>
                          <div>
                            <p className="font-medium text-gray-900 text-sm">{appt.patient_name}</p>
                            {appt.patient_phone && <p className="text-xs text-gray-400">{appt.patient_phone}</p>}
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <p className="text-sm text-gray-900">{new Date(appt.appointment_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</p>
                        <p className="text-xs text-gray-400 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {appt.appointment_time.slice(0,5)} · {appt.duration_minutes}min
                        </p>
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-sm text-gray-600 capitalize">{appt.appointment_type?.replace('-', ' ')}</span>
                      </td>
                      <td className="py-3 px-4">
                        <select
                          value={appt.status}
                          onChange={e => handleStatusChange(appt.id, e.target.value)}
                          className={`text-xs px-2 py-1 rounded-full font-medium border-0 ${STATUS_COLORS[appt.status] || 'bg-gray-100 text-gray-800'}`}
                        >
                          <option value="scheduled">Scheduled</option>
                          <option value="confirmed">Confirmed</option>
                          <option value="completed">Completed</option>
                          <option value="cancelled">Cancelled</option>
                          <option value="no_show">No Show</option>
                        </select>
                      </td>
                      <td className="py-3 px-4">
                        {appt.reminder_sent ? (
                          <span className="text-xs text-green-600 flex items-center gap-1"><CheckCircle className="w-3 h-3" /> Sent</span>
                        ) : (
                          <span className="text-xs text-gray-400">Pending</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-3">
                          <SessionTimerButton appointmentId={appt.id} />
                          <TelehealthButton appointmentId={appt.id} compact />
                          <Link
                            href={`/dashboard/ehr/notes/new?appointment_id=${appt.id}`}
                            className="inline-flex items-center gap-1 text-xs text-teal-700 hover:text-teal-900 font-medium"
                            title="Document this session — AI-draftable"
                          >
                            <FileText className="w-3 h-3" />
                            Document
                          </Link>
                          <button onClick={() => openEdit(appt)} className="text-xs text-teal-600 hover:text-teal-800">Edit</button>
                          <button onClick={() => handleCancel(appt.id)} className="text-xs text-red-500 hover:text-red-700">Cancel</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg">
            <div className="p-6 border-b border-gray-100">
              <h2 className="text-lg font-semibold">{selectedAppt ? 'Edit Appointment' : 'New Appointment'}</h2>
            </div>
            <div className="p-6 space-y-4">
              {error && <div className="bg-red-50 text-red-700 text-sm p-3 rounded-lg">{error}</div>}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Patient Name *</label>
                  <input
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                    value={form.patient_name}
                    onChange={e => setForm(f => ({ ...f, patient_name: e.target.value }))}
                    placeholder="Jane Smith"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                  <input
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                    value={form.patient_phone}
                    onChange={e => setForm(f => ({ ...f, patient_phone: e.target.value }))}
                    placeholder="+1 (555) 000-0000"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Date *</label>
                  <input
                    type="date"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                    value={form.appointment_date}
                    onChange={e => setForm(f => ({ ...f, appointment_date: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Time *</label>
                  <input
                    type="time"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                    value={form.appointment_time}
                    onChange={e => setForm(f => ({ ...f, appointment_time: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Duration</label>
                  <select
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                    value={form.duration_minutes}
                    onChange={e => setForm(f => ({ ...f, duration_minutes: Number(e.target.value) }))}
                  >
                    <option value={30}>30 minutes</option>
                    <option value={45}>45 minutes</option>
                    <option value={50}>50 minutes</option>
                    <option value={60}>60 minutes</option>
                    <option value={90}>90 minutes</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                  <select
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                    value={form.appointment_type}
                    onChange={e => setForm(f => ({ ...f, appointment_type: e.target.value }))}
                  >
                    <option value="in-person">In-Person</option>
                    <option value="telehealth">Telehealth</option>
                    <option value="phone">Phone</option>
                  </select>
                </div>
              </div>
              <div>
                
              {!selectedAppt && (
                <div className="mb-3">
                  <RecurrencePicker
                    value={form.recurrence}
                    onChange={(v) => setForm({ ...form, recurrence: v })}
                  />
                </div>
              )}
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                  rows={2}
                  value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="Optional notes..."
                />
              </div>
            </div>
            <div className="p-6 border-t border-gray-100 flex justify-end gap-3">
              <button
                onClick={() => { setShowModal(false); setSelectedAppt(null); setError('') }}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !form.patient_name || !form.appointment_date}
                className="px-6 py-2 bg-teal-600 text-white text-sm rounded-lg hover:bg-teal-700 disabled:opacity-50"
              >
                {saving ? 'Saving...' : selectedAppt ? 'Save Changes' : 'Create Appointment'}
              </button>
            </div>
          </div>
        </div>
      )}
  
    {/* Intake Send Modal */}
    {intakeModal && (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm">
          <div className="p-6 border-b border-gray-100">
            <h2 className="text-lg font-semibold text-gray-900">Send Intake Form</h2>
            <p className="text-sm text-gray-500 mt-1">to {intakeModal.patient_name}</p>
          </div>
          <div className="p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone (SMS)</label>
              <input
                type="tel"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                value={intakePhone}
                onChange={e => setIntakePhone(e.target.value)}
                placeholder="+1 (555) 000-0000"
              />
            </div>
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <div className="flex-1 border-t border-gray-100" />
              <span>and / or</span>
              <div className="flex-1 border-t border-gray-100" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                type="email"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                value={intakeEmail}
                onChange={e => setIntakeEmail(e.target.value)}
                placeholder="patient@email.com"
              />
            </div>
            <p className="text-xs text-gray-400">We'll send a secure link with the PHQ-9 & GAD-7 intake form. Link expires in 7 days.</p>
          </div>
          <div className="p-6 border-t border-gray-100 flex justify-end gap-3">
            <button
              onClick={() => setIntakeModal(null)}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
            >
              Cancel
            </button>
            <button
              onClick={handleSendIntake}
              disabled={!intakePhone && !intakeEmail}
              className="px-6 py-2 bg-purple-600 text-white text-sm rounded-lg hover:bg-purple-700 disabled:opacity-40"
            >
              Send Intake →
            </button>
          </div>
        </div>
      </div>
    )}
</>
  )
}
