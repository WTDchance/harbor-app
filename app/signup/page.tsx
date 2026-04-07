'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Check, ArrowRight, ArrowLeft, Phone, Shield, Clock, Star,
  Building2, User, Mail, Lock, MapPin, Stethoscope, Heart,
  Calendar, MessageSquare, Wifi, FileText
} from 'lucide-react'
import { createClient } from '@/lib/supabase-browser'

const STEPS = ['Your Practice', 'Services & Hours', 'Your Account', 'Customize Ellie', 'Intake Forms']

const SPECIALTIES = [
  'Individual Therapy', 'Couples Therapy', 'Family Therapy',
  'Child & Adolescent', 'Anxiety & Depression', 'Trauma & PTSD',
  'Addiction & Recovery', 'Grief & Loss', 'Eating Disorders',
  'EMDR', 'CBT', 'DBT', 'Play Therapy', 'Group Therapy',
]

const INSURANCE_OPTIONS = [
  'Aetna', 'Anthem / BCBS', 'Cigna', 'United Healthcare',
  'Humana', 'Kaiser', 'Medicaid', 'Medicare',
  'Tricare', 'Optum', 'Magellan', 'Beacon Health',
  'Self-Pay Only', 'Sliding Scale',
]

const TIMEZONES = [
  { value: 'America/New_York', label: 'Eastern (ET)' },
  { value: 'America/Chicago', label: 'Central (CT)' },
  { value: 'America/Denver', label: 'Mountain (MT)' },
  { value: 'America/Los_Angeles', label: 'Pacific (PT)' },
  { value: 'America/Anchorage', label: 'Alaska (AKT)' },
  { value: 'Pacific/Honolulu', label: 'Hawaii (HST)' },
]

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
const DAY_LABELS: Record<string, string> = {
  monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu',
  friday: 'Fri', saturday: 'Sat', sunday: 'Sun',
}

interface HoursDay {
  enabled: boolean
  open: string
  close: string
}

type HoursMap = Record<string, HoursDay>

const DEFAULT_HOURS: HoursMap = {
  monday: { enabled: true, open: '09:00', close: '17:00' },
  tuesday: { enabled: true, open: '09:00', close: '17:00' },
  wednesday: { enabled: true, open: '09:00', close: '17:00' },
  thursday: { enabled: true, open: '09:00', close: '17:00' },
  friday: { enabled: true, open: '09:00', close: '17:00' },
  saturday: { enabled: false, open: '09:00', close: '13:00' },
  sunday: { enabled: false, open: '09:00', close: '13:00' },
}

// Starter intake form templates — must match slugs in /api/intake/documents/templates
const INTAKE_TEMPLATES = [
  {
    slug: 'hipaa-notice',
    name: 'HIPAA Notice of Privacy Practices',
    blurb: 'Standard privacy notice required by federal law.',
    recommended: true,
  },
  {
    slug: 'informed-consent',
    name: 'Informed Consent for Therapy',
    blurb: 'Explains the nature of therapy, risks, and confidentiality.',
    recommended: true,
  },
  {
    slug: 'telehealth-consent',
    name: 'Telehealth Consent',
    blurb: 'For practices offering video or phone sessions.',
    recommended: false,
  },
  {
    slug: 'cancellation-policy',
    name: 'Cancellation Policy',
    blurb: '24-hour cancellation policy with optional fee.',
    recommended: true,
  },
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
    email: '',
    password: '',
    confirm_password: '',
    ai_name: 'Ellie',
    greeting: '',
    timezone: 'America/Los_Angeles',
    telehealth: true,
    accepting_new_patients: true,
    tos_accepted: false,
    baa_acknowledged: false,
  })

  const [specialties, setSpecialties] = useState<string[]>([])
  const [insurance, setInsurance] = useState<string[]>([])
  const [hours, setHours] = useState<HoursMap>(DEFAULT_HOURS)

  // Step 4: intake template selection — default to recommended templates
  const [selectedTemplates, setSelectedTemplates] = useState<string[]>(
    INTAKE_TEMPLATES.filter((t) => t.recommended).map((t) => t.slug)
  )
  const [adoptingTemplates, setAdoptingTemplates] = useState(false)
  const [templatesAdopted, setTemplatesAdopted] = useState(false)

  const u = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }))

  const toggleChip = (arr: string[], setArr: (v: string[]) => void, val: string) => {
    setArr(arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val])
  }

  const updateHours = (day: string, field: keyof HoursDay, value: any) => {
    setHours((prev) => ({ ...prev, [day]: { ...prev[day], [field]: value } }))
  }

  // Validation per step
  const validateStep = (s: number): boolean => {
    setError('')
    if (s === 0) {
      if (!form.practice_name.trim()) { setError('Practice name is required'); return false }
      if (!form.provider_name.trim()) { setError('Provider name is required'); return false }
    }
    if (s === 2) {
      if (!form.email.trim()) { setError('Email is required'); return false }
      if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) { setError('Enter a valid email address'); return false }
      if (!form.password) { setError('Password is required'); return false }
      if (form.password.length < 8) { setError('Password must be at least 8 characters'); return false }
      if (form.password !== form.confirm_password) { setError('Passwords do not match'); return false }
      if (!form.tos_accepted) { setError('Please accept the Terms of Service to continue'); return false }
      if (!form.baa_acknowledged) { setError('Please acknowledge the Business Associate Agreement to continue'); return false }
    }
    return true
  }

  const next = () => {
    if (validateStep(step)) setStep(step + 1)
  }
  const back = () => { setError(''); setStep(step - 1) }

  // Step 3 → step 4: create account, sign in, advance to intake step
  const submit = async () => {
    if (!validateStep(3)) return
    setLoading(true)
    setError('')

    const defaultGreeting = `Thank you for calling ${form.practice_name}. This is ${form.ai_name}, the AI receptionist for ${form.provider_name}. How can I help you today?`

    // Build hours_json
    const hours_json: Record<string, any> = {}
    for (const day of DAYS) {
      hours_json[day] = {
        enabled: hours[day].enabled,
        openTime: hours[day].open,
        closeTime: hours[day].close,
      }
    }

    try {
      const res = await fetch('/api/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          email: form.email.trim().toLowerCase(),
          greeting: form.greeting || defaultGreeting,
          specialties,
          insurance_accepted: insurance,
          hours_json,
        }),
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        setError(data.error || 'Signup failed. Please try again.')
        setLoading(false)
        return
      }

      // Sign the user in client-side so the dashboard loads with a real session.
      // Without this, middleware would bounce them to /login because no auth cookie
      // was ever set by the admin createUser call in /api/signup.
      try {
        const supabase = createClient()
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: form.email.trim().toLowerCase(),
          password: form.password,
        })
        if (signInError) {
          console.error('Auto sign-in failed:', signInError)
          // Fall through – they'll be asked to sign in from the success screen.
        }
      } catch (e) {
        console.error('Auto sign-in threw:', e)
      }

      setStep(4) // intake forms step
      setLoading(false)
    } catch {
      setError('Signup failed. Please try again.')
      setLoading(false)
    }
  }

  // Step 4 → step 5: adopt selected templates and advance to success
  const adoptTemplatesAndFinish = async () => {
    setError('')
    if (selectedTemplates.length === 0) {
      // User chose nothing — treat as skip
      setStep(5)
      return
    }
    setAdoptingTemplates(true)
    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/intake/documents/templates', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token ?? ''}`,
        },
        body: JSON.stringify({ slugs: selectedTemplates }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || 'Could not add templates. You can still upload them from the dashboard.')
        setAdoptingTemplates(false)
        return
      }
      setTemplatesAdopted(true)
      setStep(5)
    } catch (e) {
      console.error('Template adoption failed:', e)
      setError('Could not add templates. You can still upload them from the dashboard.')
    } finally {
      setAdoptingTemplates(false)
    }
  }

  // ---------- Chip component ----------
  const Chip = ({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) => (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-all ${
        selected
          ? 'bg-teal-600 border-teal-600 text-white'
          : 'bg-slate-800 border-slate-600 text-slate-300 hover:border-teal-500'
      }`}
    >
      {selected && <Check className="w-3 h-3 inline mr-1" />}
      {label}
    </button>
  )

  // ---------- Success screen ----------
  if (step === 5) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <div className="max-w-md w-full text-center">
          <div className="w-20 h-20 bg-teal-500 rounded-full flex items-center justify-center mx-auto mb-6">
            <Check className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white mb-3">Welcome to Harbor!</h1>
          <p className="text-slate-400 mb-2">
            {form.ai_name} is being set up for <strong className="text-white">{form.practice_name}</strong>.
          </p>
          {templatesAdopted && (
            <p className="text-teal-400 text-sm mb-2">
              ✓ Starter intake forms added — you can edit them anytime.
            </p>
          )}
          <p className="text-slate-500 text-sm mb-8">
            Next: connect your calendar, claim your Harbor phone number, and run a test call — all from your dashboard.
          </p>
          <button
            onClick={() => router.push('/dashboard?welcome=1')}
            className="w-full bg-teal-500 hover:bg-teal-600 text-white font-bold py-3 px-6 rounded-lg transition-colors"
          >
            Go to Dashboard
          </button>
          <p className="text-slate-600 text-xs mt-6">
            Your 14-day free trial has started. No credit card required.
          </p>
        </div>
      </div>
    )
  }

  // ---------- Main form ----------
  return (
    <div className="min-h-screen bg-slate-900">
      {/* Header bar */}
      <div className="border-b border-slate-800">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-teal-500 rounded-lg flex items-center justify-center">
              <Phone className="w-4 h-4 text-white" />
            </div>
            <span className="text-white font-bold text-xl">Harbor</span>
          </div>
          <div className="flex items-center gap-6 text-sm text-slate-400">
            <span className="flex items-center gap-1"><Shield className="w-3 h-3" /> HIPAA Ready</span>
            <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> 5 min setup</span>
            <span className="flex items-center gap-1"><Star className="w-3 h-3" /> 14-day free trial</span>
          </div>
        </div>
      </div>

      <div className="max-w-xl mx-auto px-4 py-10">
        {/* Step indicator */}
        <div className="mb-10">
          <div className="flex items-center justify-between mb-2">
            {STEPS.map((s, i) => (
              <div key={s} className="flex items-center">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-colors ${
                    i < step
                      ? 'bg-teal-500 text-white'
                      : i === step
                      ? 'bg-teal-500 text-white'
                      : 'bg-slate-700 text-slate-400'
                  }`}
                >
                  {i < step ? <Check className="w-4 h-4" /> : i + 1}
                </div>
                {i < STEPS.length - 1 && (
                  <div className={`h-0.5 w-12 sm:w-16 mx-1 sm:mx-2 transition-colors ${i < step ? 'bg-teal-500' : 'bg-slate-700'}`} />
                )}
              </div>
            ))}
          </div>
          <div className="flex justify-between text-xs text-slate-500 mt-1">
            {STEPS.map((s) => (
              <span key={s} className="max-w-[70px] text-center">{s}</span>
            ))}
          </div>
        </div>

        {/* Form card */}
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-8">
          <h2 className="text-2xl font-bold text-white mb-1">{STEPS[step]}</h2>
          <p className="text-slate-400 mb-6 text-sm">
            {step === 0 && "Tell us about your practice so your AI receptionist can represent you perfectly."}
            {step === 1 && "What services do you offer? This helps your receptionist answer patient questions."}
            {step === 2 && "Create your account to access your Harbor dashboard."}
            {step === 3 && "Customize how your AI receptionist introduces herself to callers."}
            {step === 4 && "Pick the consent forms patients should sign during intake. You can edit or replace them anytime from your dashboard."}
          </p>

          {error && (
            <div className="bg-red-900/30 border border-red-700 text-red-400 text-sm rounded-lg px-4 py-3 mb-6">
              {error}
            </div>
          )}

          {/* ========== STEP 0: Practice basics ========== */}
          {step === 0 && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">
                  <Building2 className="w-4 h-4 inline mr-1" />Practice Name *
                </label>
                <input type="text" value={form.practice_name} onChange={(e) => u('practice_name', e.target.value)}
                  placeholder="Westside Therapy Associates"
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-teal-500 transition-colors" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">
                  <User className="w-4 h-4 inline mr-1" />Provider Name *
                </label>
                <input type="text" value={form.provider_name} onChange={(e) => u('provider_name', e.target.value)}
                  placeholder="Dr. Sarah Johnson"
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-teal-500 transition-colors" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">
                  <Phone className="w-4 h-4 inline mr-1" />Practice Phone
                </label>
                <input type="tel" value={form.phone} onChange={(e) => u('phone', e.target.value)}
                  placeholder="(555) 123-4567"
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-teal-500 transition-colors" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1.5">
                    <MapPin className="w-4 h-4 inline mr-1" />City
                  </label>
                  <input type="text" value={form.city} onChange={(e) => u('city', e.target.value)}
                    placeholder="Portland"
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-teal-500 transition-colors" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1.5">State</label>
                  <input type="text" value={form.state} onChange={(e) => u('state', e.target.value.toUpperCase())}
                    placeholder="OR" maxLength={2}
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-teal-500 transition-colors" />
                </div>
              </div>
              <button onClick={next}
                className="w-full bg-teal-500 hover:bg-teal-600 text-white font-bold py-3 px-6 rounded-lg transition-colors flex items-center justify-center gap-2 mt-2">
                Continue <ArrowRight className="w-5 h-5" />
              </button>
            </div>
          )}

          {/* ========== STEP 1: Services & Hours ========== */}
          {step === 1 && (
            <div className="space-y-6">
              {/* Specialties */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  <Stethoscope className="w-4 h-4 inline mr-1" />Specialties
                </label>
                <p className="text-xs text-slate-500 mb-2">Select all that apply</p>
                <div className="flex flex-wrap gap-2">
                  {SPECIALTIES.map((s) => (
                    <Chip key={s} label={s} selected={specialties.includes(s)}
                      onClick={() => toggleChip(specialties, setSpecialties, s)} />
                  ))}
                </div>
              </div>

              {/* Insurance */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  <Shield className="w-4 h-4 inline mr-1" />Insurance Accepted
                </label>
                <p className="text-xs text-slate-500 mb-2">Select all that apply</p>
                <div className="flex flex-wrap gap-2">
                  {INSURANCE_OPTIONS.map((ins) => (
                    <Chip key={ins} label={ins} selected={insurance.includes(ins)}
                      onClick={() => toggleChip(insurance, setInsurance, ins)} />
                  ))}
                </div>
              </div>

              {/* Telehealth + Accepting */}
              <div className="flex gap-6">
                <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                  <input type="checkbox" checked={form.telehealth}
                    onChange={(e) => u('telehealth', e.target.checked)}
                    className="w-4 h-4 rounded border-slate-600 bg-slate-700 text-teal-500 focus:ring-teal-500" />
                  <Wifi className="w-4 h-4" /> Telehealth available
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                  <input type="checkbox" checked={form.accepting_new_patients}
                    onChange={(e) => u('accepting_new_patients', e.target.checked)}
                    className="w-4 h-4 rounded border-slate-600 bg-slate-700 text-teal-500 focus:ring-teal-500" />
                  <Heart className="w-4 h-4" /> Accepting new patients
                </label>
              </div>

              {/* Timezone */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">
                  <Clock className="w-4 h-4 inline mr-1" />Timezone
                </label>
                <select value={form.timezone} onChange={(e) => u('timezone', e.target.value)}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-teal-500 transition-colors">
                  {TIMEZONES.map((tz) => <option key={tz.value} value={tz.value}>{tz.label}</option>)}
                </select>
              </div>

              {/* Office hours grid */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  <Calendar className="w-4 h-4 inline mr-1" />Office Hours
                </label>
                <div className="space-y-2">
                  {DAYS.map((day) => (
                    <div key={day} className="flex items-center gap-3">
                      <label className="flex items-center gap-2 w-20 cursor-pointer">
                        <input type="checkbox" checked={hours[day].enabled}
                          onChange={(e) => updateHours(day, 'enabled', e.target.checked)}
                          className="w-4 h-4 rounded border-slate-600 bg-slate-700 text-teal-500 focus:ring-teal-500" />
                        <span className={`text-sm font-medium ${hours[day].enabled ? 'text-slate-200' : 'text-slate-500'}`}>
                          {DAY_LABELS[day]}
                        </span>
                      </label>
                      {hours[day].enabled ? (
                        <div className="flex items-center gap-2">
                          <input type="time" value={hours[day].open}
                            onChange={(e) => updateHours(day, 'open', e.target.value)}
                            className="bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-teal-500" />
                          <span className="text-slate-500 text-sm">to</span>
                          <input type="time" value={hours[day].close}
                            onChange={(e) => updateHours(day, 'close', e.target.value)}
                            className="bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-teal-500" />
                        </div>
                      ) : (
                        <span className="text-slate-500 text-sm">Closed</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex gap-3 mt-2">
                <button onClick={back}
                  className="flex-1 bg-slate-700 hover:bg-slate-600 text-white font-medium py-3 px-6 rounded-lg transition-colors flex items-center justify-center gap-2">
                  <ArrowLeft className="w-5 h-5" /> Back
                </button>
                <button onClick={next}
                  className="flex-1 bg-teal-500 hover:bg-teal-600 text-white font-bold py-3 px-6 rounded-lg transition-colors flex items-center justify-center gap-2">
                  Continue <ArrowRight className="w-5 h-5" />
                </button>
              </div>
            </div>
          )}

          {/* ========== STEP 2: Account ========== */}
          {step === 2 && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">
                  <Mail className="w-4 h-4 inline mr-1" />Email Address *
                </label>
                <input type="email" value={form.email} onChange={(e) => u('email', e.target.value)}
                  placeholder="dr.johnson@westside.com"
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-teal-500 transition-colors" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">
                  <Lock className="w-4 h-4 inline mr-1" />Password *
                </label>
                <input type="password" value={form.password} onChange={(e) => u('password', e.target.value)}
                  placeholder="Min 8 characters"
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-teal-500 transition-colors" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">
                  <Lock className="w-4 h-4 inline mr-1" />Confirm Password *
                </label>
                <input type="password" value={form.confirm_password} onChange={(e) => u('confirm_password', e.target.value)}
                  placeholder="Re-enter your password"
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-teal-500 transition-colors" />
              </div>

              {/* Legal consents */}
              <div className="space-y-3 pt-2">
                <label className="flex items-start gap-3 text-xs text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.tos_accepted}
                    onChange={(e) => u('tos_accepted', e.target.checked)}
                    className="mt-0.5 w-4 h-4 rounded border-slate-600 bg-slate-700 text-teal-500 focus:ring-teal-500"
                  />
                  <span>
                    I agree to the{' '}
                    <a href="/terms" target="_blank" className="text-teal-400 hover:text-teal-300 underline">Terms of Service</a>{' '}
                    and{' '}
                    <a href="/privacy-policy" target="_blank" className="text-teal-400 hover:text-teal-300 underline">Privacy Policy</a>.
                  </span>
                </label>
                <label className="flex items-start gap-3 text-xs text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.baa_acknowledged}
                    onChange={(e) => u('baa_acknowledged', e.target.checked)}
                    className="mt-0.5 w-4 h-4 rounded border-slate-600 bg-slate-700 text-teal-500 focus:ring-teal-500"
                  />
                  <span>
                    I acknowledge that Harbor processes Protected Health Information (PHI) and I agree to
                    execute Harbor's Business Associate Agreement (BAA) before going live with real patients.
                  </span>
                </label>
              </div>

              <div className="flex gap-3 mt-2">
                <button onClick={back}
                  className="flex-1 bg-slate-700 hover:bg-slate-600 text-white font-medium py-3 px-6 rounded-lg transition-colors flex items-center justify-center gap-2">
                  <ArrowLeft className="w-5 h-5" /> Back
                </button>
                <button onClick={next}
                  className="flex-1 bg-teal-500 hover:bg-teal-600 text-white font-bold py-3 px-6 rounded-lg transition-colors flex items-center justify-center gap-2">
                  Continue <ArrowRight className="w-5 h-5" />
                </button>
              </div>
            </div>
          )}

          {/* ========== STEP 3: Customize Ellie ========== */}
          {step === 3 && (
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">
                  <MessageSquare className="w-4 h-4 inline mr-1" />AI Receptionist Name
                </label>
                <input type="text" value={form.ai_name} onChange={(e) => u('ai_name', e.target.value)}
                  placeholder="Ellie"
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-teal-500 transition-colors" />
                <p className="text-xs text-slate-500 mt-1">This is how your AI receptionist will introduce herself.</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">
                  Greeting Script
                </label>
                <textarea value={form.greeting} onChange={(e) => u('greeting', e.target.value)} rows={4}
                  placeholder={`Thank you for calling ${form.practice_name || 'your practice'}. This is ${form.ai_name || 'Ellie'}, the AI receptionist for ${form.provider_name || 'your provider'}. How can I help you today?`}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-teal-500 transition-colors resize-none" />
                <p className="text-xs text-slate-500 mt-1">Leave blank to use the default greeting shown above.</p>
              </div>

              {/* Calendar note */}
              <div className="bg-slate-700/50 border border-slate-600 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <Calendar className="w-5 h-5 text-teal-400 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-slate-200">Connect your calendar after signup</p>
                    <p className="text-xs text-slate-400 mt-1">
                      You can connect Google Calendar or Apple Calendar from your dashboard settings.
                      This lets {form.ai_name || 'Ellie'} check availability and book appointments in real time.
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex gap-3 mt-2">
                <button onClick={back}
                  className="flex-1 bg-slate-700 hover:bg-slate-600 text-white font-medium py-3 px-6 rounded-lg transition-colors flex items-center justify-center gap-2">
                  <ArrowLeft className="w-5 h-5" /> Back
                </button>
                <button onClick={submit} disabled={loading}
                  className="flex-1 bg-teal-500 hover:bg-teal-600 disabled:opacity-50 text-white font-bold py-3 px-6 rounded-lg transition-colors flex items-center justify-center gap-2">
                  {loading ? 'Setting up...' : 'Continue'}
                  {!loading && <ArrowRight className="w-5 h-5" />}
                </button>
              </div>
            </div>
          )}

          {/* ========== STEP 4: Intake Forms ========== */}
          {step === 4 && (
            <div className="space-y-5">
              <div className="bg-slate-700/40 border border-slate-600 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <FileText className="w-5 h-5 text-teal-400 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-slate-200">Starter intake forms</p>
                    <p className="text-xs text-slate-400 mt-1">
                      We'll add these as editable templates to your practice. You can review,
                      customize, or replace them with your own PDFs anytime from
                      <span className="text-teal-300"> Dashboard → Intake → Documents</span>.
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                {INTAKE_TEMPLATES.map((tpl) => {
                  const checked = selectedTemplates.includes(tpl.slug)
                  return (
                    <label
                      key={tpl.slug}
                      className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                        checked
                          ? 'bg-teal-500/10 border-teal-500'
                          : 'bg-slate-700/30 border-slate-600 hover:border-slate-500'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setSelectedTemplates((prev) =>
                            prev.includes(tpl.slug)
                              ? prev.filter((s) => s !== tpl.slug)
                              : [...prev, tpl.slug]
                          )
                        }
                        className="mt-0.5 w-4 h-4 rounded border-slate-600 bg-slate-700 text-teal-500 focus:ring-teal-500"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-slate-100">{tpl.name}</p>
                          {tpl.recommended && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-teal-500/20 text-teal-300 font-semibold uppercase tracking-wide">
                              Recommended
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-400 mt-0.5">{tpl.blurb}</p>
                      </div>
                    </label>
                  )
                })}
              </div>

              <p className="text-xs text-slate-500">
                Got your own forms? You can upload PDFs from your dashboard after signup.
                These templates are a generic starting point — please review them with your attorney before going live.
              </p>

              <div className="flex gap-3 mt-2">
                <button
                  onClick={() => setStep(5)}
                  className="flex-1 bg-slate-700 hover:bg-slate-600 text-white font-medium py-3 px-6 rounded-lg transition-colors"
                >
                  Skip for now
                </button>
                <button
                  onClick={adoptTemplatesAndFinish}
                  disabled={adoptingTemplates}
                  className="flex-1 bg-teal-500 hover:bg-teal-600 disabled:opacity-50 text-white font-bold py-3 px-6 rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                  {adoptingTemplates
                    ? 'Adding...'
                    : selectedTemplates.length > 0
                    ? `Add ${selectedTemplates.length} & Finish`
                    : 'Finish'}
                  {!adoptingTemplates && <ArrowRight className="w-5 h-5" />}
                </button>
              </div>
            </div>
          )}
        </div>

        <p className="text-center text-slate-500 text-sm mt-6">
          Already have an account?{' '}
          <a href="/login" className="text-teal-400 hover:text-teal-300">Sign in</a>
        </p>
      </div>
    </div>
  )
}
