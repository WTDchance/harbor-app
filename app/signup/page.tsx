'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, ArrowRight, Phone, Shield, Clock, Star, Building2, User, Mail, Lock, MapPin, Stethoscope } from 'lucide-react'

const STEPS = ['Your Practice', 'Your Account', "Ellie's Setup"]

const SPECIALTIES = [
  'General Therapy',
  'Anxiety & Depression',
  'Trauma & PTSD',
  'Couples & Family',
  'Child & Adolescent',
  'Addiction & Recovery',
  'Grief & Loss',
]

const TIMEZONES = [
  { value: 'America/New_York', label: 'Eastern (ET)' },
  { value: 'America/Chicago', label: 'Central (CT)' },
  { value: 'America/Denver', label: 'Mountain (MT)' },
  { value: 'America/Los_Angeles', label: 'Pacific (PT)' },
]

export default function SignupPage() {
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    practice_name: '',
    provider_name: '',
    phone: '',
    city: '',
    state: '',
    specialty: 'general',
    email: '',
    password: '',
    confirm_password: '',
    greeting: '',
    timezone: 'America/New_York',
    office_hours_start: '09:00',
    office_hours_end: '17:00',
  })

  const u = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }))

  const step1 = () => {
    if (!form.practice_name || !form.provider_name) {
      setError('Practice name and provider name are required')
      return
    }
    setError('')
    setStep(1)
  }

  const step2 = () => {
    if (!form.email || !form.password) {
      setError('Email and password are required')
      return
    }
    if (form.password !== form.confirm_password) {
      setError('Passwords do not match')
      return
    }
    if (form.password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    if (!form.greeting) {
      u('greeting', `Thank you for calling ${form.practice_name}. This is Ellie, the AI assistant. How can I help you today?`)
    }
    setError('')
    setStep(2)
  }

  const submit = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (data.error) {
        setError(data.error)
        setLoading(false)
        return
      }
      setStep(3)
    } catch {
      setError('Signup failed. Please try again.')
      setLoading(false)
    }
  }

  const specialties = [
    'General Therapy',
    'Anxiety & Depression',
    'Trauma & PTSD',
    'Couples & Family',
    'Child & Adolescent',
    'Addiction & Recovery',
    'Grief & Loss',
  ]

  if (step === 3) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <div className="max-w-md w-full text-center">
          <div className="w-20 h-20 bg-yellow-400 rounded-full flex items-center justify-center mx-auto mb-6">
            <Check className="w-10 h-10 text-slate-900" />
          </div>
          <h1 className="text-3xl font-bold text-white mb-4">Harbor is Live!</h1>
          <p className="text-slate-400 mb-8">
            Ellie is ready to answer calls for {form.practice_name}. Head to your dashboard to complete setup.
          </p>
          <button
            onClick={() => router.push('/dashboard')}
            className="w-full bg-yellow-400 hover:bg-yellow-500 text-slate-900 font-bold py-3 px-6 rounded-lg transition-colors"
          >
            Go to Dashboard
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-900">
      <div className="border-b border-slate-800">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-yellow-400 rounded-lg flex items-center justify-center">
              <Phone className="w-4 h-4 text-slate-900" />
            </div>
            <span className="text-white font-bold text-xl">Harbor</span>
          </div>
          <div className="flex items-center gap-6 text-sm text-slate-400">
            <span className="flex items-center gap-1"><Shield className="w-3 h-3" /> HIPAA Ready</span>
            <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> 2-min setup</span>
            <span className="flex items-center gap-1"><Star className="w-3 h-3" /> $499/mo</span>
          </div>
        </div>
      </div>

      <div className="max-w-xl mx-auto px-4 py-12">
        <div className="mb-10">
          <div className="flex items-center justify-between mb-2">
            {STEPS.map((s, i) => (
              <div key={s} className="flex items-center">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-colors ${
                  i < step ? 'bg-yellow-400 text-slate-900' :
                  i === step ? 'bg-yellow-400 text-slate-900' :
                  'bg-slate-700 text-slate-400'
                }`}>
                  {i < step ? <Check className="w-4 h-4" /> : i + 1}
                </div>
                {i < STEPS.length - 1 && (
                  <div className={`h-0.5 w-24 mx-2 transition-colors ${i < step ? 'bg-yellow-400' : 'bg-slate-700'}`} />
                )}
              </div>
            ))}
          </div>
          <div className="flex justify-between text-xs text-slate-500 mt-1">
            {STEPS.map((s) => <span key={s}>{s}</span>)}
          </div>
        </div>

        <div className="bg-slate-800 border border-slate-700 rounded-xl p-8">
          <h2 className="text-2xl font-bold text-white mb-2">{STEPS[step]}</h2>
          <p className="text-slate-400 mb-8 text-sm">
            {step === 0 && "Tell us about your practice so Ellie can represent you perfectly."}
            {step === 1 && "Create your account to access your Harbor dashboard."}
            {step === 2 && "Customize how Ellie greets your patients."}
          </p>

          {error && (
            <div className="bg-red-900/30 border border-red-700 text-red-400 text-sm rounded-lg px-4 py-3 mb-6">
              {error}
            </div>
          )}

          {step === 0 && (
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  <Building2 className="w-4 h-4 inline mr-1" />Practice Name *
                </label>
                <input
                  type="text"
                  value={form.practice_name}
                  onChange={(e) => u('practice_name', e.target.value)}
                  placeholder="Westside Therapy Associates"
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-yellow-400 transition-colors"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  <User className="w-4 h-4 inline mr-1" />Provider Name *
                </label>
                <input
                  type="text"
                  value={form.provider_name}
                  onChange={(e) => u('provider_name', e.target.value)}
                  placeholder="Dr. Sarah Johnson"
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-yellow-400 transition-colors"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  <Stethoscope className="w-4 h-4 inline mr-1" />Specialty
                </label>
                <select
                  value={form.specialty}
                  onChange={(e) => u('specialty', e.target.value)}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-yellow-400 transition-colors"
                >
                  {specialties.map((s) => (
                    <option key={s} value={s.toLowerCase().replace(/\s+/g, '_')}>{s}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  <Phone className="w-4 h-4 inline mr-1" />Practice Phone
                </label>
                <input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => u('phone', e.target.value)}
                  placeholder="(555) 123-4567"
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-yellow-400 transition-colors"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    <MapPin className="w-4 h-4 inline mr-1" />City
                  </label>
                  <input
                    type="text"
                    value={form.city}
                    onChange={(e) => u('city', e.target.value)}
                    placeholder="Los Angeles"
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-yellow-400 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">State</label>
                  <input
                    type="text"
                    value={form.state}
                    onChange={(e) => u('state', e.target.value)}
                    placeholder="CA"
                    maxLength={2}
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-yellow-400 transition-colors"
                  />
                </div>
              </div>
              <button
                onClick={step1}
                className="w-full bg-yellow-400 hover:bg-yellow-500 text-slate-900 font-bold py-3 px-6 rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                Continue <ArrowRight className="w-5 h-5" />
              </button>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  <Mail className="w-4 h-4 inline mr-1" />Email Address *
                </label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => u('email', e.target.value)}
                  placeholder="dr.johnson@westside.com"
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-yellow-400 transition-colors"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  <Lock className="w-4 h-4 inline mr-1" />Password *
                </label>
                <input
                  type="password"
                  value={form.password}
                  onChange={(e) => u('password', e.target.value)}
                  placeholder="Min 8 characters"
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-yellow-400 transition-colors"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  <Lock className="w-4 h-4 inline mr-1" />Confirm Password *
                </label>
                <input
                  type="password"
                  value={form.confirm_password}
                  onChange={(e) => u('confirm_password', e.target.value)}
                  placeholder="Re-enter your password"
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-yellow-400 transition-colors"
                />
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setStep(0)}
                  className="flex-1 bg-slate-700 hover:bg-slate-600 text-white font-medium py-3 px-6 rounded-lg transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={step2}
                  className="flex-1 bg-yellow-400 hover:bg-yellow-500 text-slate-900 font-bold py-3 px-6 rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                  Continue <ArrowRight className="w-5 h-5" />
                </button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Ellie&apos;s Greeting
                </label>
                <textarea
                  value={form.greeting}
                  onChange={(e) => u('greeting', e.target.value)}
                  rows={4}
                  placeholder={`Thank you for calling ${form.practice_name || 'your practice'}. This is Ellie, the AI assistant. How can I help you today?`}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-yellow-400 transition-colors resize-none"
                />
                <p className="text-xs text-slate-500 mt-1">This is how Ellie will introduce herself to callers.</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  <Clock className="w-4 h-4 inline mr-1" />Timezone
                </label>
                <select
                  value={form.timezone}
                  onChange={(e) => u('timezone', e.target.value)}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-yellow-400 transition-colors"
                >
                  {TIMEZONES.map((tz) => (
                    <option key={tz.value} value={tz.value}>{tz.label}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Office Opens</label>
                  <input
                    type="time"
                    value={form.office_hours_start}
                    onChange={(e) => u('office_hours_start', e.target.value)}
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-yellow-400 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Office Closes</label>
                  <input
                    type="time"
                    value={form.office_hours_end}
                    onChange={(e) => u('office_hours_end', e.target.value)}
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-yellow-400 transition-colors"
                  />
                </div>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setStep(1)}
                  className="flex-1 bg-slate-700 hover:bg-slate-600 text-white font-medium py-3 px-6 rounded-lg transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={submit}
                  disabled={loading}
                  className="flex-1 bg-yellow-400 hover:bg-yellow-500 disabled:opacity-50 text-slate-900 font-bold py-3 px-6 rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                  {loading ? 'Launching...' : 'Launch Harbor'} {!loading && <ArrowRight className="w-5 h-5" />}
                </button>
              </div>
            </div>
          )}
        </div>

        <p className="text-center text-slate-500 text-sm mt-6">
          Already have an account?{' '}
          <a href="/login" className="text-yellow-400 hover:text-yellow-300">Sign in</a>
        </p>
      </div>
    </div>
  )
}
