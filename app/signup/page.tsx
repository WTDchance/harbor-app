'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  Check, ArrowRight, ArrowLeft, Phone, Shield, Clock, Star,
  Building2, User, Mail, Lock, MapPin, Stethoscope, Heart,
  Calendar, MessageSquare, Wifi, CreditCard, Search,
} from 'lucide-react'

const STEPS = ['Your Practice', 'Services & Hours', 'Your Account', 'Customize Ellie', 'Choose Your Number']

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

interface HoursDay { enabled: boolean; open: string; close: string }
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

interface FoundingInfo {
  remaining: number
  cap: number
  is_founding_available: boolean
  price_cents: number
  regular_price_cents: number
}

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(0)}`
}

export default function SignupPage() {
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [founding, setFounding] = useState<FoundingInfo | null>(null)

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
    sms_consent: false,
    promo_code: '',
  })
  const [specialties, setSpecialties] = useState<string[]>([])
  const [insurance, setInsurance] = useState<string[]>([])
  const [hours, setHours] = useState<HoursMap>(DEFAULT_HOURS)

  // Phone picker state
  const [areaCode, setAreaCode] = useState('')
  const [availableNumbers, setAvailableNumbers] = useState<Array<{ phoneNumber: string; friendlyName: string; locality: string; region: string }>>([])
  const [selectedNumber, setSelectedNumber] = useState('')
  const [searchingNumbers, setSearchingNumbers] = useState(false)

  useEffect(() => {
    fetch('/api/signup/founding-count')
      .then((r) => r.json())
      .then((d) => setFounding(d))
      .catch(() => {})
  }, [])

  const u = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }))
  const toggleChip = (arr: string[], setArr: (v: string[]) => void, val: string) => {
    setArr(arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val])
  }
  const updateHours = (day: string, field: keyof HoursDay, value: any) => {
    setHours((prev) => ({ ...prev, [day]: { ...prev[day], [field]: value } }))
  }

  const searchNumbers = async () => {
    if (!areaCode || areaCode.length !== 3) {
      setError('Please enter a valid 3-digit area code')
      return
    }
    setSearchingNumbers(true)
    setError('')
    try {
      const res = await fetch(`/api/twilio/available-numbers?areaCode=${areaCode}`)
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to search for numbers')
        setAvailableNumbers([])
      } else {
        setAvailableNumbers(data.numbers || [])
        if ((data.numbers || []).length === 0) {
          setError('No numbers found for that area code. Try a different one.')
        }
      }
    } catch {
      setError('Failed to search for numbers. Please try again.')
    } finally {
      setSearchingNumbers(false)
    }
  }

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
    if (s === 4) {
      if (!selectedNumber) { setError('Please select a phone number for your practice'); return false }
    }
    return true
  }

  const next = () => { if (validateStep(step)) setStep(step + 1) }
  const back = () => { setError(''); setStep(step - 1) }

  const submit = async () => {
    if (!validateStep(4)) return
    setLoading(true)
    setError('')

    const defaultGreeting =
      `Thank you for calling ${form.practice_name}. This is ${form.ai_name}, the AI receptionist for ${form.provider_name}. How can I help you today?`

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
          selected_phone_number: selectedNumber,
        }),
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        setError(data.error || 'Signup failed. Please try again.')
        setLoading(false)
        return
      }
      if (!data.checkout_url) {
        setError('Unable to create checkout session. Please try again.')
        setLoading(false)
        return
      }
      // Redirect to Stripe Checkout
      window.location.href = data.checkout_url
    } catch {
      setError('Signup failed. Please try again.')
      setLoading(false)
    }
  }

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

  const priceCents = founding?.price_cents ?? 19700
  const isFounding = !!founding?.is_founding_available
  const remaining = founding?.remaining ?? 20

  return (
    <div className="min-h-screen bg-slate-900">
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
            <span className="flex items-center gap-1"><CreditCard className="w-3 h-3" /> Card required</span>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-8">
        {isFounding && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-4 py-3 mb-6 flex items-center gap-3">
            <Star className="w-5 h-5 text-amber-400 flex-shrink-0" />
            <div>
              <p className="text-amber-200 font-medium text-sm">Founding Member Pricing</p>
              <p className="text-amber-300/70 text-xs">{remaining} of {founding?.cap ?? 20} spots remaining at {formatPrice(priceCents)}/mo (regular {formatPrice(founding?.regular_price_cents ?? 39700)}/mo)</p>
            </div>
          </div>
        )}

        <div className="flex justify-center gap-2 mb-8">
          {STEPS.map((s, i) => (
            <div key={s} className="flex items-center">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                i < step ? 'bg-teal-500 text-white' : i === step ? 'bg-teal-500/20 text-teal-400 border border-teal-500' : 'bg-slate-800 text-slate-500'
              }`}>
                {i < step ? <Check className="w-4 h-4" /> : i + 1}
              </div>
              {i < STEPS.length - 1 && <div className={`w-8 h-0.5 mx-1 ${i < step ? 'bg-teal-500' : 'bg-slate-700'}`} />}
            </div>
          ))}
        </div>
        <div className="flex justify-center gap-1 mb-6">
          {STEPS.map((s) => <span key={s} className="max-w-[70px] text-center">{s}</span>)}
        </div>

        <div className="bg-slate-800 border border-slate-700 rounded-xl p-8">
          <h2 className="text-2xl font-bold text-white mb-1">{STEPS[step]}</h2>
          <p className="text-slate-400 mb-6 text-sm">
            {step === 0 && "Tell us about your practice so your AI receptionist can represent you perfectly."}
            {step === 1 && "What services do you offer? This helps your receptionist answer patient questions."}
            {step === 2 && "Create your account to access your Harbor dashboard."}
            {step === 3 && "Customize how your AI receptionist introduces herself to callers."}
            {step === 4 && "Choose a dedicated phone number for your AI receptionist."}
          </p>

          {error && (
            <div className="bg-red-900/30 border border-red-700 text-red-400 text-sm rounded-lg px-4 py-3 mb-6">
              {error}
            </div>
          )}

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
                  <input type="text" value={form.state} onChange={(e) => u('state', e.target.value)}
                    placeholder="OR"
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-teal-500 transition-colors" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">
                  <Calendar className="w-4 h-4 inline mr-1" />Timezone
                </label>
                <select value={form.timezone} onChange={(e) => u('timezone', e.target.value)}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-teal-500 transition-colors">
                  {TIMEZONES.map((tz) => <option key={tz.value} value={tz.value}>{tz.label}</option>)}
                </select>
              </div>
              <div className="flex gap-6">
                <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                  <input type="checkbox" checked={form.telehealth} onChange={(e) => u('telehealth', e.target.checked)}
                    className="mt-0.5 w-4 h-4 rounded border-slate-600 bg-slate-700 text-teal-500 focus:ring-teal-500" />
                  <Wifi className="w-4 h-4" /> Offers telehealth
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                  <input type="checkbox" checked={form.accepting_new_patients} onChange={(e) => u('accepting_new_patients', e.target.checked)}
                    className="mt-0.5 w-4 h-4 rounded border-slate-600 bg-slate-700 text-teal-500 focus:ring-teal-500" />
                  <Heart className="w-4 h-4" /> Accepting new patients
                </label>
              </div>

              <div className="flex justify-end mt-2">
                <button onClick={next}
                  className="flex-1 bg-teal-500 hover:bg-teal-600 text-white font-bold py-3 px-6 rounded-lg transition-colors flex items-center justify-center gap-2">
                  Continue <ArrowRight className="w-5 h-5" />
                </button>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  <Stethoscope className="w-4 h-4 inline mr-1" />Specialties
                </label>
                <p className="text-xs text-slate-500 mb-2">Select all that apply. Your receptionist will reference these.</p>
                <div className="flex flex-wrap gap-2">
                  {SPECIALTIES.map((s) => (
                    <Chip key={s} label={s} selected={specialties.includes(s)} onClick={() => toggleChip(specialties, setSpecialties, s)} />
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Insurance Accepted</label>
                <p className="text-xs text-slate-500 mb-2">Select the insurance plans you accept.</p>
                <div className="flex flex-wrap gap-2">
                  {INSURANCE_OPTIONS.map((ins) => (
                    <Chip key={ins} label={ins} selected={insurance.includes(ins)} onClick={() => toggleChip(insurance, setInsurance, ins)} />
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  <Clock className="w-4 h-4 inline mr-1" />Office Hours
                </label>
                <div className="space-y-2">
                  {DAYS.map((day) => (
                    <div key={day} className="flex items-center gap-3">
                      <label className="flex items-center gap-2 w-20">
                        <input type="checkbox" checked={hours[day].enabled} onChange={(e) => updateHours(day, 'enabled', e.target.checked)}
                          className="w-4 h-4 rounded border-slate-600 bg-slate-700 text-teal-500 focus:ring-teal-500" />
                        <span className="text-sm text-slate-300">{DAY_LABELS[day]}</span>
                      </label>
                      {hours[day].enabled && (
                        <>
                          <input type="time" value={hours[day].open} onChange={(e) => updateHours(day, 'open', e.target.value)}
                            className="bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm text-white" />
                          <span className="text-slate-500">to</span>
                          <input type="time" value={hours[day].close} onChange={(e) => updateHours(day, 'close', e.target.value)}
                            className="bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm text-white" />
                        </>
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

              <div className="space-y-3 pt-2">
                <label className="flex items-start gap-3 text-xs text-slate-300 cursor-pointer">
                  <input type="checkbox" checked={form.tos_accepted}
                    onChange={(e) => u('tos_accepted', e.target.checked)}
                    className="mt-0.5 w-4 h-4 rounded border-slate-600 bg-slate-700 text-teal-500 focus:ring-teal-500" />
                  <span>
                    I agree to the{' '}
                    <a href="/terms" target="_blank" className="text-teal-400 hover:text-teal-300 underline">Terms of Service</a>{' '}
                    and{' '}
                    <a href="/privacy-policy" target="_blank" className="text-teal-400 hover:text-teal-300 underline">Privacy Policy</a>.
                  </span>
                </label>
                <label className="flex items-start gap-3 text-xs text-slate-300 cursor-pointer">
                  <input type="checkbox" checked={form.baa_acknowledged}
                    onChange={(e) => u('baa_acknowledged', e.target.checked)}
                    className="mt-0.5 w-4 h-4 rounded border-slate-600 bg-slate-700 text-teal-500 focus:ring-teal-500" />
                  <span>
                    I acknowledge that Harbor processes Protected Health Information (PHI) and I agree to
                    execute Harbor&apos;s Business Associate Agreement (BAA) before going live with patients.
                  </span>
                </label>
                <label className="flex items-start gap-3 text-xs text-slate-300 cursor-pointer">
                  <input type="checkbox" checked={form.sms_consent}
                    onChange={(e) => u('sms_consent', e.target.checked)}
                    className="mt-0.5 w-4 h-4 rounded border-slate-600 bg-slate-700 text-teal-500 focus:ring-teal-500" />
                  <span>I consent to receive SMS messages from Harbor for appointment reminders and practice notifications.</span>
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
                <label className="block text-sm font-medium text-slate-300 mb-1.5">Greeting Script</label>
                <textarea value={form.greeting} onChange={(e) => u('greeting', e.target.value)} rows={4}
                  placeholder={`Thank you for calling ${form.practice_name || 'your practice'}. This is ${form.ai_name || 'Ellie'}, the AI receptionist for ${form.provider_name || 'your provider'}. How can I help you today?`}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-teal-500 transition-colors resize-none" />
                <p className="text-xs text-slate-500 mt-1">Leave blank to use the default greeting shown above.</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">
                  Promo Code <span className="text-slate-500 font-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  value={form.promo_code}
                  onChange={(e) => u('promo_code', e.target.value.toUpperCase())}
                  placeholder="Have a code? Enter it here"
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-teal-500 transition-colors uppercase"
                />
                <p className="text-xs text-slate-500 mt-1">
                  If you have a special access code, enter it here. Otherwise, leave blank.
                </p>
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

          {step === 4 && (
            <div className="space-y-5">
              <p className="text-sm text-slate-400">
                Search for an available phone number by area code. This will be the number patients call to reach {form.ai_name || 'your AI receptionist'}.
              </p>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-slate-300 mb-1.5">
                    <Search className="w-4 h-4 inline mr-1" />Area Code
                  </label>
                  <input
                    type="text"
                    value={areaCode}
                    onChange={(e) => setAreaCode(e.target.value.replace(/\D/g, '').slice(0, 3))}
                    placeholder="541"
                    maxLength={3}
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-teal-500 transition-colors"
                  />
                </div>
                <div className="flex items-end">
                  <button
                    onClick={searchNumbers}
                    disabled={searchingNumbers || areaCode.length !== 3}
                    className="bg-teal-500 hover:bg-teal-600 disabled:opacity-50 text-white font-medium py-3 px-6 rounded-lg transition-colors flex items-center gap-2"
                  >
                    {searchingNumbers ? 'Searching...' : 'Search'}
                    {!searchingNumbers && <Search className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {availableNumbers.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Available Numbers ({availableNumbers.length})
                  </label>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {availableNumbers.map((num) => (
                      <button
                        key={num.phoneNumber}
                        type="button"
                        onClick={() => setSelectedNumber(num.phoneNumber)}
                        className={`w-full text-left px-4 py-3 rounded-lg border transition-all ${
                          selectedNumber === num.phoneNumber
                            ? 'bg-teal-500/20 border-teal-500 text-white'
                            : 'bg-slate-700 border-slate-600 text-slate-300 hover:border-teal-500'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="font-mono font-medium">{num.friendlyName}</span>
                            {num.locality && (
                              <span className="text-sm text-slate-400 ml-2">{num.locality}, {num.region}</span>
                            )}
                          </div>
                          {selectedNumber === num.phoneNumber && (
                            <Check className="w-5 h-5 text-teal-400" />
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {selectedNumber && (
                <div className="bg-teal-500/10 border border-teal-500/30 rounded-lg px-4 py-3">
                  <p className="text-sm text-teal-300">
                    <Phone className="w-4 h-4 inline mr-1" />
                    Selected: <span className="font-mono font-bold">{selectedNumber}</span>
                  </p>
                  <p className="text-xs text-teal-400/70 mt-1">This number will be purchased and assigned to your practice after checkout.</p>
                </div>
              )}

              <div className="bg-slate-700/50 border border-slate-600 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <CreditCard className="w-5 h-5 text-teal-400 mt-0.5 flex-shrink-0" />
                  <div className="text-sm">
                    <p className="font-medium text-slate-200">
                      You&apos;ll be charged <strong className="text-teal-300">{formatPrice(priceCents)}</strong>/mo
                    </p>
                    {isFounding && <span className="text-amber-300"> Founding Practice rate locked forever</span>}
                    <p className="text-xs text-slate-400 mt-1">
                      Payment is processed securely by Stripe. You can cancel anytime from your dashboard.
                      30-day money-back guarantee.
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
                  {loading ? 'Redirecting to checkout\u2026' : 'Continue to Checkout'}
                  {!loading && <ArrowRight className="w-5 h-5" />}
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
