'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, CheckCircle } from 'lucide-react'
import Link from 'next/link'

interface FormData {
  therapist_name: string
  practice_name: string
  notification_email: string
  phone_number: string
  hours: string
  location: string
  telehealth: boolean
  specialties: string
  insurance_accepted: string
  ai_name: string
  system_prompt_notes: string
}

export default function ProvisionPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ success: boolean; practice?: { id: string; name: string; vapi_assistant_id: string }; error?: string } | null>(null)
  const [form, setForm] = useState<FormData>({
    therapist_name: '',
    practice_name: '',
    notification_email: '',
    phone_number: '',
    hours: 'Monday–Friday, 9am–5pm',
    location: '',
    telehealth: true,
    specialties: '',
    insurance_accepted: '',
    ai_name: 'Ellie',
    system_prompt_notes: '',
  })

  const update = (field: keyof FormData, value: string | boolean) => {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    const payload = {
      ...form,
      specialties: form.specialties ? form.specialties.split(',').map(s => s.trim()) : [],
      insurance_accepted: form.insurance_accepted ? form.insurance_accepted.split(',').map(s => s.trim()) : [],
      phone_number: form.phone_number || undefined,
    }

    const res = await fetch('/api/provision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    const data = await res.json()
    setResult(data)
    setLoading(false)
  }

  if (result?.success) {
    return (
      <div className="max-w-lg mx-auto text-center py-16">
        <CheckCircle className="w-16 h-16 text-teal-500 mx-auto mb-4" />
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Practice Created!</h2>
        <p className="text-gray-500 mb-2">{result.practice?.name} is now on Harbor.</p>
        <p className="text-sm text-gray-400 mb-6">
          Vapi assistant ID: <code className="bg-gray-100 px-1 rounded">{result.practice?.vapi_assistant_id}</code>
        </p>
        <div className="flex gap-3 justify-center">
          <Link href="/admin" className="bg-teal-600 text-white px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-teal-700">
            Back to Admin
          </Link>
          <button onClick={() => { setResult(null); setForm({ therapist_name: '', practice_name: '', notification_email: '', phone_number: '', hours: 'Monday–Friday, 9am–5pm', location: '', telehealth: true, specialties: '', insurance_accepted: '', ai_name: 'Ellie', system_prompt_notes: '' }) }}
            className="border border-gray-200 text-gray-700 px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-50">
            Add another
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/admin" className="text-gray-400 hover:text-gray-600">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Add a Therapist</h1>
          <p className="text-gray-500 text-sm mt-0.5">Creates a Vapi assistant + practice record. Ready in seconds.</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Core info */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <h3 className="font-semibold text-gray-900">Practice Information</h3>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Therapist Name *</label>
              <input type="text" required value={form.therapist_name} onChange={e => update('therapist_name', e.target.value)}
                placeholder="Dr. Jane Smith"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Practice Name *</label>
              <input type="text" required value={form.practice_name} onChange={e => update('practice_name', e.target.value)}
                placeholder="Hope and Harmony Counseling"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notification Email *</label>
              <input type="email" required value={form.notification_email} onChange={e => update('notification_email', e.target.value)}
                placeholder="therapist@practice.com"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number</label>
              <input type="text" value={form.phone_number} onChange={e => update('phone_number', e.target.value)}
                placeholder="+1 (555) 000-0000"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Hours</label>
              <input type="text" value={form.hours} onChange={e => update('hours', e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Location</label>
              <input type="text" value={form.location} onChange={e => update('location', e.target.value)}
                placeholder="123 Main St, City, State"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Specialties (comma-separated)</label>
              <input type="text" value={form.specialties} onChange={e => update('specialties', e.target.value)}
                placeholder="Trauma, Anxiety, Depression"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Insurance Accepted</label>
              <input type="text" value={form.insurance_accepted} onChange={e => update('insurance_accepted', e.target.value)}
                placeholder="Aetna, BCBS, Self-pay"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <input type="checkbox" id="telehealth" checked={form.telehealth}
              onChange={e => update('telehealth', e.target.checked)}
              className="w-4 h-4 rounded accent-teal-600" />
            <label htmlFor="telehealth" className="text-sm text-gray-700">Offers telehealth / video sessions</label>
          </div>
        </div>

        {/* AI assistant */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <h3 className="font-semibold text-gray-900">AI Assistant (Ellie)</h3>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Assistant Name</label>
            <input type="text" value={form.ai_name} onChange={e => update('ai_name', e.target.value)}
              placeholder="Ellie"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Additional instructions for the AI</label>
            <textarea value={form.system_prompt_notes} onChange={e => update('system_prompt_notes', e.target.value)}
              rows={3}
              placeholder="e.g. She specializes in trauma and has written a children's book. Very warm and relaxed style."
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none" />
          </div>
        </div>

        {result?.error && (
          <p className="text-red-500 text-sm bg-red-50 rounded-lg px-3 py-2">{result.error}</p>
        )}

        <button type="submit" disabled={loading}
          className="w-full bg-teal-600 hover:bg-teal-700 disabled:bg-teal-300 text-white font-semibold py-3 rounded-xl transition-colors">
          {loading ? 'Creating practice & Vapi assistant...' : 'Create Practice'}
        </button>
      </form>
    </div>
  )
}
