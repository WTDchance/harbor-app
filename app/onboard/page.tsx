'use client'

import { useState } from 'react'

const SPECIALTIES = ['Anxiety', 'Depression', 'Trauma/PTSD', 'Couples Therapy', 'Family Therapy',
  'Grief & Loss', 'Addiction', 'OCD', 'ADHD', 'Eating Disorders', 'Teen/Adolescent', 'LGBTQ+']

const INSURERS = ['Aetna', 'BlueCross BlueShield', 'Cigna', 'United Healthcare', 'Humana',
  'Medicare', 'Medicaid', 'Tricare', 'Self-Pay / Private Pay']

const HOURS_OPTIONS = [
  'Monday–Friday, 9am–5pm',
  'Monday–Friday, 8am–6pm',
  'Monday–Saturday, 9am–5pm',
  'By appointment only',
  'Evenings and weekends available',
]

type Step = 1 | 2 | 3 | 4

export default function OnboardPage() {
  const [step, setStep] = useState<Step>(1)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [form, setForm] = useState({
    therapist_name: '',
    practice_name: '',
    notification_email: '',
    therapist_phone: '',
    specialties: [] as string[],
    hours: '',
    location: '',
    telehealth: true,
    insurance_accepted: [] as string[],
  })

  const toggle = (arr: string[], item: string) =>
    arr.includes(item) ? arr.filter(i => i !== item) : [...arr, item]

  const handleSubmit = async () => {
    setSubmitting(true)
    try {
      const res = await fetch('/api/provision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (res.ok) {
        setDone(true)
      } else {
        const err = await res.json()
        alert(`Error: ${err.error || 'Failed to provision'}`)
      }
    } catch (e) {
      console.error(e)
      alert('Error submitting form')
    }
    setSubmitting(false)
  }

  if (done) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-teal-50 to-white flex items-center justify-center p-4">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 bg-teal-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-teal-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Ellie is getting set up!</h1>
          <p className="text-gray-500">Check your email for your login link. Your AI receptionist will be ready within minutes.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-teal-50 to-white flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        {/* Harbor logo */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-teal-600">Harbor</h1>
          <p className="text-gray-500 mt-1">Your AI receptionist, ready in minutes</p>
        </div>

        {/* Progress */}
        <div className="flex items-center gap-2 mb-8">
          {[1, 2, 3, 4].map(s => (
            <div key={s} className={`flex-1 h-1.5 rounded-full transition-colors ${step >= s ? 'bg-teal-600' : 'bg-gray-200'}`} />
          ))}
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
          {step === 1 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-gray-900">Tell us about yourself</h2>
              {[
                { label: "Your full name", key: "therapist_name", placeholder: "Dr. Jane Smith" },
                { label: "Practice name", key: "practice_name", placeholder: "Harmony Counseling" },
                { label: "Email address", key: "notification_email", placeholder: "jane@harmonycounseling.com", type: "email" },
                { label: "Cell phone (for crisis alerts)", key: "therapist_phone", placeholder: "+1 (555) 000-0000", type: "tel" },
              ].map(({ label, key, placeholder, type }) => (
                <div key={key}>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
                  <input
                    type={type || 'text'}
                    value={form[key as keyof typeof form] as string}
                    onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                    placeholder={placeholder}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </div>
              ))}
              <button
                onClick={() => setStep(2)}
                disabled={!form.therapist_name || !form.practice_name || !form.notification_email}
                className="w-full bg-teal-600 text-white py-2.5 rounded-lg font-medium hover:bg-teal-700 disabled:opacity-50 transition-colors"
              >
                Continue →
              </button>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-gray-900">Practice details</h2>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Specialties</label>
                <div className="flex flex-wrap gap-2">
                  {SPECIALTIES.map(s => (
                    <button
                      key={s}
                      onClick={() => setForm(f => ({ ...f, specialties: toggle(f.specialties, s) }))}
                      className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                        form.specialties.includes(s)
                          ? 'bg-teal-600 text-white border-teal-600'
                          : 'bg-white text-gray-700 border-gray-200 hover:border-teal-400'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Office hours</label>
                <select
                  value={form.hours}
                  onChange={e => setForm(f => ({ ...f, hours: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                >
                  <option value="">Select hours...</option>
                  {HOURS_OPTIONS.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Office location</label>
                <input
                  type="text"
                  value={form.location}
                  onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
                  placeholder="Seattle, WA or full address"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setForm(f => ({ ...f, telehealth: !f.telehealth }))}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${form.telehealth ? 'bg-teal-600' : 'bg-gray-200'}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${form.telehealth ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
                <span className="text-sm font-medium text-gray-700">Offer telehealth sessions</span>
              </div>
              <div className="flex gap-3">
                <button onClick={() => setStep(1)} className="flex-1 border border-gray-200 text-gray-700 py-2.5 rounded-lg font-medium hover:bg-gray-50 transition-colors">← Back</button>
                <button onClick={() => setStep(3)} className="flex-1 bg-teal-600 text-white py-2.5 rounded-lg font-medium hover:bg-teal-700 transition-colors">Continue →</button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-gray-900">Insurance accepted</h2>
              <div className="flex flex-wrap gap-2">
                {INSURERS.map(ins => (
                  <button
                    key={ins}
                    onClick={() => setForm(f => ({ ...f, insurance_accepted: toggle(f.insurance_accepted, ins) }))}
                    className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                      form.insurance_accepted.includes(ins)
                        ? 'bg-teal-600 text-white border-teal-600'
                        : 'bg-white text-gray-700 border-gray-200 hover:border-teal-400'
                    }`}
                  >
                    {ins}
                  </button>
                ))}
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={() => setStep(2)} className="flex-1 border border-gray-200 text-gray-700 py-2.5 rounded-lg font-medium hover:bg-gray-50 transition-colors">← Back</button>
                <button onClick={() => setStep(4)} className="flex-1 bg-teal-600 text-white py-2.5 rounded-lg font-medium hover:bg-teal-700 transition-colors">Continue →</button>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-gray-900">Ready to launch Ellie</h2>
              <div className="bg-teal-50 rounded-xl p-4 space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-gray-500">Practice</span><span className="font-medium">{form.practice_name}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Therapist</span><span className="font-medium">{form.therapist_name}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Specialties</span><span className="font-medium">{form.specialties.length} selected</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Telehealth</span><span className="font-medium">{form.telehealth ? 'Yes' : 'No'}</span></div>
              </div>
              <p className="text-sm text-gray-500">We'll send a login link to <strong>{form.notification_email}</strong>. Ellie will be live within minutes.</p>
              <div className="flex gap-3">
                <button onClick={() => setStep(3)} className="flex-1 border border-gray-200 text-gray-700 py-2.5 rounded-lg font-medium hover:bg-gray-50 transition-colors">← Back</button>
                <button
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="flex-1 bg-teal-600 text-white py-2.5 rounded-lg font-medium hover:bg-teal-700 disabled:opacity-50 transition-colors"
                >
                  {submitting ? 'Launching...' : '🚀 Launch Ellie'}
                </button>
              </div>
            </div>
          )}
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">$499/month · Cancel anytime · Setup takes 5 minutes</p>
      </div>
    </div>
  )
}
