'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase-browser'
import { usePractice } from '@/lib/hooks/usePractice'
import MFAEnroll from '@/components/MFAEnroll'
import { ForwardingToggle } from '@/components/ForwardingToggle'

const TIMEZONES = [
  'America/Los_Angeles',
  'America/Denver',
  'America/Chicago',
  'America/New_York',
  'America/Phoenix',
  'America/Anchorage',
  'Pacific/Honolulu',
]

type GCalStatus = { connected: boolean; email: string | null } | null
type AppleCalStatus = { connected: boolean; username: string | null; calendarCount?: number } | null
type SchedulingMode = 'harbor_driven' | 'notification'
type RecapMethod = 'email' | 'sms' | 'both'
type TabKey = 'account' | 'practice' | 'calendar' | 'billing'

interface Therapist {
  id: string
  display_name: string
  credentials: string | null
  bio: string | null
  is_primary: boolean
  is_active: boolean
  created_at?: string
  updated_at?: string
}

const BIO_SOFT_CAP = 1500

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const
const DAY_LABELS: Record<string, string> = {
  monday: 'Monday', tuesday: 'Tuesday', wednesday: 'Wednesday', thursday: 'Thursday',
  friday: 'Friday', saturday: 'Saturday', sunday: 'Sunday',
}

interface HoursDay { enabled: boolean; openTime: string; closeTime: string }
type HoursMap = Record<string, HoursDay>

const DEFAULT_HOURS: HoursMap = {
  monday: { enabled: true, openTime: '09:00', closeTime: '17:00' },
  tuesday: { enabled: true, openTime: '09:00', closeTime: '17:00' },
  wednesday: { enabled: true, openTime: '09:00', closeTime: '17:00' },
  thursday: { enabled: true, openTime: '09:00', closeTime: '17:00' },
  friday: { enabled: true, openTime: '09:00', closeTime: '17:00' },
  saturday: { enabled: false, openTime: '09:00', closeTime: '13:00' },
  sunday: { enabled: false, openTime: '09:00', closeTime: '13:00' },
}

// --- MFA Settings Section (HIPAA §164.312(d)) --------------------------------
function MFASection() {
  const supabase = createClient()
  const [mfaEnabled, setMfaEnabled] = useState(false)
  const [showEnroll, setShowEnroll] = useState(false)
  const [loading, setLoading] = useState(true)
  const [unenrolling, setUnenrolling] = useState(false)

  const checkMFA = useCallback(async () => {
    const { data } = await supabase.auth.mfa.listFactors()
    setMfaEnabled(!!(data?.totp && data.totp.length > 0))
    setLoading(false)
  }, [supabase])

  useEffect(() => { checkMFA() }, [checkMFA])

  async function handleUnenroll() {
    if (!confirm('Are you sure you want to disable two-factor authentication? This will make your account less secure.')) return
    setUnenrolling(true)
    try {
      const { data } = await supabase.auth.mfa.listFactors()
      const factor = data?.totp?.[0]
      if (factor) {
        await supabase.auth.mfa.unenroll({ factorId: factor.id })
        fetch('/api/audit-log', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'mfa_unenrolled', details: { factor_id: factor.id }, severity: 'warning' }),
        }).catch(() => {})
      }
      setMfaEnabled(false)
    } catch {}
    setUnenrolling(false)
  }

  if (loading) return null

  return (
    <div className="bg-white rounded-xl border border-gray-200 mb-6">
      <div className="p-5 border-b border-gray-100">
        <h2 className="font-semibold text-gray-700 text-sm uppercase tracking-wide">Account Security</h2>
        <p className="text-xs text-gray-400 mt-1">Protect your account with two-factor authentication</p>
      </div>
      <div className="p-5">
        {showEnroll ? (
          <MFAEnroll
            onComplete={() => { setShowEnroll(false); setMfaEnabled(true) }}
            onCancel={() => setShowEnroll(false)}
          />
        ) : mfaEnabled ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-green-50 flex items-center justify-center">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M3 8.5l3 3 7-7" stroke="#16a34a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900">Two-factor authentication is enabled</p>
                <p className="text-xs text-gray-500">Your account is protected with an authenticator app</p>
              </div>
            </div>
            <button
              onClick={handleUnenroll}
              disabled={unenrolling}
              className="text-sm text-red-600 hover:text-red-700 font-medium disabled:opacity-50"
            >
              {unenrolling ? 'Disabling...' : 'Disable'}
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-amber-50 flex items-center justify-center">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M8 2l-6 12h12L8 2z" stroke="#d97706" strokeWidth="1.5" strokeLinejoin="round" />
                  <path d="M8 7v3M8 12v0.5" stroke="#d97706" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900">Two-factor authentication is not enabled</p>
                <p className="text-xs text-gray-500">Add an extra layer of security to your account</p>
              </div>
            </div>
            <button
              onClick={() => setShowEnroll(true)}
              className="px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors"
              style={{ backgroundColor: '#1f375d' }}
            >
              Enable 2FA
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default function SettingsPage() {
  const [practice, setPractice] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    name: '',
    ai_name: '',
    phone_number: '',
    fax_number: '',
    timezone: 'America/Los_Angeles',
    insurance_accepted: '',
    notification_emails: '',
    npi: '',
    tax_id: '',
  })

  // Scheduling mode state
  const [schedulingMode, setSchedulingMode] = useState<SchedulingMode>('notification')
  const [dailyRecapEnabled, setDailyRecapEnabled] = useState(true)
  const [dailyRecapTime, setDailyRecapTime] = useState('19:00')
  const [dailyRecapMethod, setDailyRecapMethod] = useState<RecapMethod>('email')
  const [schedulingSaving, setSchedulingSaving] = useState(false)
  const [schedulingSaved, setSchedulingSaved] = useState(false)

  // Google Calendar state
  // HIPAA BAA attestation modal state. The Connect Google Calendar button
  // now opens this modal FIRST; the actual OAuth handoff only happens
  // after the practice owner confirms both attestations.
  const [gcalBaaModalOpen, setGcalBaaModalOpen] = useState(false)
  const [gcalAttestWorkspace, setGcalAttestWorkspace] = useState(false)
  const [gcalAttestBaa, setGcalAttestBaa] = useState(false)

  // Crisis resources: per-practice referral list Ellie reads to crisis
  // callers. is_crisis_capable governs whether Ellie promises therapist
  // follow-up (true) or routes to 988 + local resources (false, default).
  type CrisisResource = {
    id: string; name: string; phone: string | null; text_line: string | null;
    description: string | null; coverage_area: string | null; availability: string | null;
    is_primary: boolean; active: boolean;
  }
  const [crisisResources, setCrisisResources] = useState<CrisisResource[]>([])
  const [crisisResourcesLoading, setCrisisResourcesLoading] = useState(true)
  const [isCrisisCapable, setIsCrisisCapable] = useState(false)
  const [crisisDraft, setCrisisDraft] = useState<Partial<CrisisResource>>({ name: '', phone: '', text_line: '', description: '', availability: '' })
  const [savingCrisis, setSavingCrisis] = useState(false)
  const [crisisCapableSaving, setCrisisCapableSaving] = useState(false)
  const [gcal, setGcal] = useState<GCalStatus>(null)
  const [gcalLoading, setGcalLoading] = useState(true)
  const [gcalDisconnecting, setGcalDisconnecting] = useState(false)
  const [gcalToast, setGcalToast] = useState<string | null>(null)

  // Apple Calendar state
  const [appleCal, setAppleCal] = useState<AppleCalStatus>(null)
  const [appleCalLoading, setAppleCalLoading] = useState(true)
  const [appleCalConnecting, setAppleCalConnecting] = useState(false)
  const [appleCalDisconnecting, setAppleCalDisconnecting] = useState(false)
  const [appleCalError, setAppleCalError] = useState<string | null>(null)
  const [appleCalForm, setAppleCalForm] = useState({ appleId: '', appPassword: '' })
  const [showAppleCalForm, setShowAppleCalForm] = useState(false)

  // Hours state
  const [hours, setHours] = useState<HoursMap>(DEFAULT_HOURS)
  const [hoursSaving, setHoursSaving] = useState(false)
  const [hoursSaved, setHoursSaved] = useState(false)

  // Greeting state
  const [greeting, setGreeting] = useState('')
  const [greetingSaving, setGreetingSaving] = useState(false)
  const [greetingSaved, setGreetingSaved] = useState(false)

  // Intake config state
  const [intakeConfig, setIntakeConfig] = useState<Record<string, boolean>>({
    demographics: true,
    insurance: true,
    presenting_concerns: true,
    medications: true,
    medical_history: true,
    prior_therapy: true,
    substance_use: true,
    family_history: false,
    phq9: true,
    gad7: true,
    consent: true,
    additional_notes: true,
  })
  const [intakeSaving, setIntakeSaving] = useState(false)
  const [intakeSaved, setIntakeSaved] = useState(false)

  // Calendar Subscription state
  const [calToken, setCalToken] = useState<string | null>(null)
  const [calFeedUrl, setCalFeedUrl] = useState<string | null>(null)
  const [calLoading, setCalLoading] = useState(true)
  const [calGenerating, setCalGenerating] = useState(false)
  const [calCopied, setCalCopied] = useState(false)

  // Active tab in the settings layout (account | practice | calendar | billing)
  const [activeTab, setActiveTab] = useState<TabKey>('practice')

  // Self-pay rate state (stored in cents on the DB, displayed as dollars)
  const [selfPayRate, setSelfPayRate] = useState<string>('')
  const [selfPayRateSaving, setSelfPayRateSaving] = useState(false)
  const [selfPayRateSaved, setSelfPayRateSaved] = useState(false)
  const [selfPayRateError, setSelfPayRateError] = useState<string | null>(null)

  // Therapists state (list + modal for add/edit)
  const [therapists, setTherapists] = useState<Therapist[]>([])
  const [therapistsLoading, setTherapistsLoading] = useState(false)
  const [showTherapistModal, setShowTherapistModal] = useState(false)
  const [editingTherapistId, setEditingTherapistId] = useState<string | null>(null)
  const [therapistForm, setTherapistForm] = useState({
    display_name: '',
    credentials: '',
    bio: '',
    is_primary: false,
    is_active: true,
  })
  const [therapistSaving, setTherapistSaving] = useState(false)
  const [therapistError, setTherapistError] = useState<string | null>(null)

  const searchParams = useSearchParams()
  const supabase = createClient()

  // Use the server-side practice resolver to respect act-as cookie
  const { practice: resolvedPractice, loading: practiceLoading, error: practiceError } = usePractice()

  useEffect(() => {
    if (practiceLoading) return
    if (practiceError) {
      setError(practiceError)
      setLoading(false)
      return
    }
    if (!resolvedPractice) {
      setError('No practice found for this account. Please complete onboarding.')
      setLoading(false)
      return
    }

    const p = resolvedPractice
    setPractice(p)
    setForm({
      name: p.name || '',
      ai_name: p.ai_name || '',
      phone_number: p.phone_number || '',
      fax_number: p.fax_number || '',
      timezone: p.timezone || 'America/Los_Angeles',
      insurance_accepted: (p.insurance_accepted || []).join(', '),
      notification_emails: (p.notification_emails || []).join(', '),
      npi: p.npi || '',
      tax_id: p.tax_id || '',
    })
    setSchedulingMode(p.scheduling_mode || 'notification')
    setDailyRecapEnabled(p.daily_recap_enabled !== false)
    setDailyRecapTime(p.daily_recap_time || '19:00')
    setDailyRecapMethod(p.daily_recap_method || 'email')
    // Load hours from hours_json
    if (p.hours_json) {
      const loaded: HoursMap = { ...DEFAULT_HOURS }
      for (const day of DAYS) {
        if (p.hours_json[day]) {
          loaded[day] = {
            enabled: p.hours_json[day].enabled ?? true,
            openTime: p.hours_json[day].openTime || '09:00',
            closeTime: p.hours_json[day].closeTime || '17:00',
          }
        }
      }
      setHours(loaded)
    }
    // Load greeting
    setGreeting(p.greeting || '')
    if (p.intake_config?.sections) {
      setIntakeConfig(prev => ({ ...prev, ...p.intake_config.sections }))
    }
    // Load self-pay rate (convert cents to dollar string; empty = unset)
    if (typeof p.self_pay_rate_cents === 'number' && p.self_pay_rate_cents >= 0) {
      setSelfPayRate((p.self_pay_rate_cents / 100).toFixed(2))
    } else {
      setSelfPayRate('')
    }
    setLoading(false)
  }, [resolvedPractice, practiceLoading, practiceError])

  // Load crisis resources + is_crisis_capable flag on mount
  useEffect(() => {
    let cancelled = false
    async function load() {
      setCrisisResourcesLoading(true)
      try {
        const [resRes, meRes] = await Promise.all([
          fetch('/api/crisis-resources'),
          fetch('/api/practice/me'),
        ])
        if (!cancelled && resRes.ok) {
          const j = await resRes.json()
          setCrisisResources(j.resources || [])
        }
        if (!cancelled && meRes.ok) {
          const j = await meRes.json()
          setIsCrisisCapable(!!j.practice?.is_crisis_capable)
        }
      } finally {
        if (!cancelled) setCrisisResourcesLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  async function addCrisisResource() {
    if (!crisisDraft.name) return
    setSavingCrisis(true)
    try {
      const res = await fetch('/api/crisis-resources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(crisisDraft),
      })
      if (res.ok) {
        const j = await res.json()
        setCrisisResources(rs => [...rs, j.resource])
        setCrisisDraft({ name: '', phone: '', text_line: '', description: '', availability: '' })
      } else {
        const j = await res.json().catch(() => ({}))
        alert('Failed to add resource: ' + (j.error || res.statusText))
      }
    } finally {
      setSavingCrisis(false)
    }
  }

  async function deleteCrisisResource(id: string) {
    if (!confirm('Remove this crisis resource? Ellie will no longer read it to callers.')) return
    const res = await fetch('/api/crisis-resources/' + id, { method: 'DELETE' })
    if (res.ok) setCrisisResources(rs => rs.filter(r => r.id !== id))
  }

  async function toggleCrisisCapable(next: boolean) {
    setIsCrisisCapable(next)
    setCrisisCapableSaving(true)
    try {
      const res = await fetch('/api/practice/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_crisis_capable: next }),
      })
      if (!res.ok) {
        // Revert on failure
        setIsCrisisCapable(!next)
        alert('Failed to update crisis-capability flag.')
      }
    } finally {
      setCrisisCapableSaving(false)
    }
  }

    // Load Google Calendar connection status
  useEffect(() => {
    const loadGcal = async () => {
      setGcalLoading(true)
      try {
        const res = await fetch('/api/integrations/google-calendar')
        if (res.ok) {
          const data = await res.json()
          setGcal(data)
        }
      } catch {}
      setGcalLoading(false)
    }
    loadGcal()
  }, [])

  // Load Apple Calendar connection status
  useEffect(() => {
    const loadAppleCal = async () => {
      setAppleCalLoading(true)
      try {
        const res = await fetch('/api/calendar/connect')
        if (res.ok) {
          const data = await res.json()
          setAppleCal(data)
        }
      } catch {}
      setAppleCalLoading(false)
    }
    loadAppleCal()
  }, [])

  // Load calendar subscription token
  useEffect(() => {
    fetch('/api/calendar/token').then(r => r.json()).then(data => {
      setCalToken(data.token)
      setCalFeedUrl(data.feedUrl)
      setCalLoading(false)
    })
  }, [])

  // Load therapists for this practice
  const loadTherapists = useCallback(async () => {
    setTherapistsLoading(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { setTherapistsLoading(false); return }
      const res = await fetch('/api/therapists', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (res.ok) {
        const json = await res.json()
        setTherapists(json.therapists || [])
      }
    } catch {}
    setTherapistsLoading(false)
  }, [supabase])

  useEffect(() => {
    if (!practiceLoading && resolvedPractice) loadTherapists()
  }, [practiceLoading, resolvedPractice, loadTherapists])

  // Read ?tab= param from URL on mount for deep-linking
  useEffect(() => {
    const tabParam = searchParams.get('tab')
    if (tabParam === 'account' || tabParam === 'practice' || tabParam === 'calendar' || tabParam === 'billing') {
      setActiveTab(tabParam)
    } else if (searchParams.get('gcal')) {
      // OAuth callback lands here — route to Calendar tab so the connection status is visible
      setActiveTab('calendar')
    }
  }, [searchParams])

  // Handle ?gcal= param from OAuth callback
  useEffect(() => {
    const gcalParam = searchParams.get('gcal')
    if (gcalParam === 'connected') {
      setGcalToast('\u2713 Google Calendar connected!')
      setGcalLoading(true)
      fetch('/api/integrations/google-calendar')
        .then(r => r.json())
        .then(data => { setGcal(data); setGcalLoading(false) })
        .catch(() => setGcalLoading(false))
    } else if (gcalParam === 'error') {
      setGcalToast('Failed to connect Google Calendar. Please try again.')
    } else if (gcalParam === 'denied') {
      setGcalToast('Google Calendar access was denied.')
    }
    if (gcalParam) setTimeout(() => setGcalToast(null), 5000)
  }, [searchParams])

  const handleSave = async () => {
    if (!practice) return
    setSaving(true)
    setError(null)

    const res = await fetch(`/api/practices/${practice.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.name,
        ai_name: form.ai_name,
        phone_number: form.phone_number,
        fax_number: form.fax_number || null,
        timezone: form.timezone,
        insurance_accepted: form.insurance_accepted.split(',').map((s: string) => s.trim()).filter(Boolean),
        notification_emails: form.notification_emails.split(',').map((s: string) => s.trim()).filter(Boolean),
        npi: form.npi.replace(/\D/g, '') || null,
        tax_id: form.tax_id.replace(/\D/g, '') || null,
      }),
    })

    setSaving(false)
    if (res.ok) {
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } else {
      setError('Failed to save. Please try again.')
    }
  }

  const handleSchedulingSave = async () => {
    if (!practice) return
    setSchedulingSaving(true)
    const res = await fetch(`/api/practices/${practice.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scheduling_mode: schedulingMode,
        daily_recap_enabled: dailyRecapEnabled,
        daily_recap_time: dailyRecapTime,
        daily_recap_method: dailyRecapMethod,
      }),
    })
    setSchedulingSaving(false)
    if (res.ok) {
      setSchedulingSaved(true)
      setTimeout(() => setSchedulingSaved(false), 3000)
    }
  }

  const handleIntakeConfigSave = async () => {
    if (!practice) return
    setIntakeSaving(true)
    const res = await fetch(`/api/practices/${practice.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intake_config: { sections: intakeConfig },
      }),
    })
    setIntakeSaving(false)
    if (res.ok) {
      setIntakeSaved(true)
      setTimeout(() => setIntakeSaved(false), 3000)
    }
  }

  const handleHoursSave = async () => {
    if (!practice) return
    setHoursSaving(true)
    const hours_json: Record<string, any> = {}
    for (const day of DAYS) {
      hours_json[day] = {
        enabled: hours[day].enabled,
        openTime: hours[day].openTime,
        closeTime: hours[day].closeTime,
      }
    }
    const res = await fetch(`/api/practices/${practice.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hours_json }),
    })
    setHoursSaving(false)
    if (res.ok) {
      setHoursSaved(true)
      setTimeout(() => setHoursSaved(false), 3000)
    }
  }

  const openTherapistModalForNew = () => {
    setEditingTherapistId(null)
    setTherapistForm({
      display_name: '',
      credentials: '',
      bio: '',
      is_primary: therapists.filter(t => t.is_active).length === 0,
      is_active: true,
    })
    setTherapistError(null)
    setShowTherapistModal(true)
  }

  const openTherapistModalForEdit = (t: Therapist) => {
    setEditingTherapistId(t.id)
    setTherapistForm({
      display_name: t.display_name || '',
      credentials: t.credentials || '',
      bio: t.bio || '',
      is_primary: t.is_primary,
      is_active: t.is_active,
    })
    setTherapistError(null)
    setShowTherapistModal(true)
  }

  const handleTherapistSave = async () => {
    if (!therapistForm.display_name.trim()) {
      setTherapistError('Display name is required.')
      return
    }
    setTherapistSaving(true)
    setTherapistError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { setTherapistSaving(false); return }
      const url = editingTherapistId ? `/api/therapists/${editingTherapistId}` : '/api/therapists'
      const method = editingTherapistId ? 'PATCH' : 'POST'
      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          display_name: therapistForm.display_name.trim(),
          credentials: therapistForm.credentials.trim() || null,
          bio: therapistForm.bio || null,
          is_primary: therapistForm.is_primary,
          is_active: therapistForm.is_active,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        setTherapistError(json.error || 'Failed to save therapist.')
        return
      }
      setShowTherapistModal(false)
      await loadTherapists()
    } catch (e: any) {
      setTherapistError(e.message || 'Network error.')
    } finally {
      setTherapistSaving(false)
    }
  }

  const handleTherapistDelete = async (id: string) => {
    if (!confirm('Remove this therapist from the active roster? Their record is kept for history and can be reactivated later.')) return
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return
      const res = await fetch(`/api/therapists/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (res.ok) await loadTherapists()
    } catch {}
  }

  const handleSelfPayRateSave = async () => {
    if (!practice) return
    setSelfPayRateError(null)

    // Parse dollar input -> cents. Empty string means unset (null on DB).
    const raw = selfPayRate.trim()
    let cents: number | null = null
    if (raw !== '') {
      const parsed = Number(raw)
      if (!isFinite(parsed) || parsed < 0) {
        setSelfPayRateError('Enter a non-negative dollar amount (e.g. 150.00) or leave blank to clear.')
        return
      }
      cents = Math.round(parsed * 100)
    }

    setSelfPayRateSaving(true)
    const res = await fetch(`/api/practices/${practice.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ self_pay_rate_cents: cents }),
    })
    setSelfPayRateSaving(false)
    if (res.ok) {
      setSelfPayRateSaved(true)
      setTimeout(() => setSelfPayRateSaved(false), 3000)
    } else {
      setSelfPayRateError('Failed to save. Please try again.')
    }
  }

  const handleGreetingSave = async () => {
    if (!practice) return
    setGreetingSaving(true)
    const res = await fetch(`/api/practices/${practice.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ greeting }),
    })
    setGreetingSaving(false)
    if (res.ok) {
      setGreetingSaved(true)
      setTimeout(() => setGreetingSaved(false), 3000)
    }
  }

  const updateHours = (day: string, field: string, value: any) => {
    setHours(prev => ({
      ...prev,
      [day]: { ...prev[day], [field]: value },
    }))
  }

  const disconnectGcal = async () => {
    setGcalDisconnecting(true)
    try {
      const res = await fetch('/api/integrations/google-calendar', { method: 'DELETE' })
      if (res.ok) {
        setGcal({ connected: false, email: null })
        setGcalToast('Google Calendar disconnected.')
        setTimeout(() => setGcalToast(null), 4000)
      }
    } catch {}
    setGcalDisconnecting(false)
  }

  const connectAppleCal = async () => {
    if (!appleCalForm.appleId || !appleCalForm.appPassword) {
      setAppleCalError('Both Apple ID and app-specific password are required.')
      return
    }
    setAppleCalConnecting(true)
    setAppleCalError(null)
    try {
      const res = await fetch('/api/calendar/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'apple',
          email: appleCalForm.appleId,
          password: appleCalForm.appPassword,
        }),
      })
      const data = await res.json()
      if (res.ok) {
        setAppleCal({ connected: true, username: appleCalForm.appleId, calendarCount: data.calendarCount })
        setShowAppleCalForm(false)
        setAppleCalForm({ appleId: '', appPassword: '' })
      } else {
        setAppleCalError(data.error || 'Failed to connect. Check your credentials.')
      }
    } catch {
      setAppleCalError('Connection failed. Please try again.')
    }
    setAppleCalConnecting(false)
  }

  const disconnectAppleCal = async () => {
    setAppleCalDisconnecting(true)
    try {
      const res = await fetch('/api/calendar/connect', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'apple' }),
      })
      if (res.ok) {
        setAppleCal({ connected: false, username: null })
      }
    } catch {}
    setAppleCalDisconnecting(false)
  }

  const generateCalToken = async () => {
    setCalGenerating(true)
    const res = await fetch('/api/calendar/token', { method: 'POST' })
    const data = await res.json()
    setCalToken(data.token)
    setCalFeedUrl(data.feedUrl)
    setCalGenerating(false)
  }

  const regenerateCalToken = async () => {
    if (!confirm('This will break your existing calendar subscription. Continue?')) return
    setCalGenerating(true)
    const res = await fetch('/api/calendar/token', { method: 'DELETE' })
    const data = await res.json()
    setCalToken(data.token)
    setCalFeedUrl(data.feedUrl)
    setCalGenerating(false)
  }

  const copyCalUrl = () => {
    if (calFeedUrl) {
      navigator.clipboard.writeText(calFeedUrl)
      setCalCopied(true)
      setTimeout(() => setCalCopied(false), 2000)
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center h-32">
      <div className="w-5 h-5 border-2 border-teal-600 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  if (error && !practice) return (
    <div className="max-w-2xl">
      <div className="bg-red-50 border border-red-200 rounded-xl p-5 text-red-700 text-sm">{error}</div>
    </div>
  )

  return (
    <div className="max-w-2xl">
      {gcalToast && (
        <div className="fixed top-4 right-4 z-50 bg-gray-900 text-white text-sm px-4 py-3 rounded-xl shadow-lg animate-fade-in">
          {gcalToast}
        </div>
      )}

      {/* Therapist Modal */}
      {showTherapistModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              {editingTherapistId ? 'Edit Therapist' : 'Add Therapist'}
            </h3>

            <label className="block text-sm font-medium text-gray-700 mb-1">
              Display Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={therapistForm.display_name}
              onChange={e => setTherapistForm(f => ({ ...f, display_name: e.target.value }))}
              placeholder="e.g. Dr. Trace Wonser"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 mb-4"
            />

            <label className="block text-sm font-medium text-gray-700 mb-1">
              Credentials <span className="text-gray-400 text-xs font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={therapistForm.credentials}
              onChange={e => setTherapistForm(f => ({ ...f, credentials: e.target.value }))}
              placeholder="e.g. LCSW, PhD, LMFT"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 mb-4"
            />

            <div className="flex items-baseline justify-between mb-1">
              <label className="block text-sm font-medium text-gray-700">
                Bio <span className="text-gray-400 text-xs font-normal">(optional)</span>
              </label>
              <span className={`text-xs ${therapistForm.bio.length > BIO_SOFT_CAP ? 'text-red-600 font-medium' : 'text-gray-400'}`}>
                {therapistForm.bio.length} / {BIO_SOFT_CAP}
              </span>
            </div>
            <textarea
              value={therapistForm.bio}
              onChange={e => setTherapistForm(f => ({ ...f, bio: e.target.value }))}
              rows={6}
              placeholder="A short paragraph about background, specialties, and approach. Ellie will reference this when callers ask about the therapist."
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none"
            />
            <p className="text-xs text-gray-400 mt-1">
              This is shared with callers &mdash; don&apos;t include anything you wouldn&apos;t say to a new patient.
            </p>

            <div className="mt-4 space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={therapistForm.is_primary}
                  onChange={e => setTherapistForm(f => ({ ...f, is_primary: e.target.checked }))}
                  className="rounded text-teal-600 focus:ring-teal-500"
                />
                <span>Primary therapist</span>
                <span className="text-xs text-gray-400">(solo-practice singular phrasing, post-call emails)</span>
              </label>
              {editingTherapistId && (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={therapistForm.is_active}
                    onChange={e => setTherapistForm(f => ({ ...f, is_active: e.target.checked }))}
                    className="rounded text-teal-600 focus:ring-teal-500"
                  />
                  <span>Active on roster</span>
                  <span className="text-xs text-gray-400">(uncheck to hide without deleting)</span>
                </label>
              )}
            </div>

            {therapistError && (
              <p className="mt-3 text-xs text-red-600">{therapistError}</p>
            )}

            <div className="mt-6 flex items-center justify-end gap-2">
              <button
                onClick={() => { setShowTherapistModal(false); setTherapistError(null) }}
                disabled={therapistSaving}
                className="px-4 py-2 text-sm font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-100 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleTherapistSave}
                disabled={therapistSaving}
                className="px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 disabled:opacity-50"
              >
                {therapistSaving ? 'Saving...' : editingTherapistId ? 'Save Changes' : 'Add Therapist'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-gray-500 mt-1">Changes sync to {practice?.ai_name || 'your AI receptionist'} automatically</p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-gray-200 mb-6 overflow-x-auto" role="tablist">
        {([
          { key: 'account', label: 'Account' },
          { key: 'practice', label: 'Practice' },
          { key: 'calendar', label: 'Calendar' },
          { key: 'billing', label: 'Billing' },
        ] as Array<{ key: TabKey; label: string }>).map(t => (
          <button
            key={t.key}
            role="tab"
            aria-selected={activeTab === t.key}
            onClick={() => setActiveTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
              activeTab === t.key
                ? 'border-teal-600 text-teal-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'account' && (
        <>
          <MFASection />
        </>
      )}

      {activeTab === 'practice' && (
        <>

      {/* Call Forwarding */}
      <div className="bg-white rounded-xl border border-gray-200 mb-6">
        <div className="p-5 border-b border-gray-100">
          <h2 className="font-semibold text-gray-700 text-sm uppercase tracking-wide">Call Forwarding</h2>
          <p className="text-xs text-gray-400 mt-1">Bypass {practice?.ai_name || 'Ellie'} and send calls straight to your phone when you need to take them yourself</p>
        </div>
        <div className="p-5">
          <ForwardingToggle />
        </div>
      </div>

      {/* Scheduling Mode */}
      <div className="bg-white rounded-xl border border-gray-200 mb-6">
        <div className="p-5 border-b border-gray-100">
          <h2 className="font-semibold text-gray-700 text-sm uppercase tracking-wide">Scheduling Mode</h2>
          <p className="text-xs text-gray-400 mt-1">How should {practice?.ai_name || 'your receptionist'} handle appointment changes?</p>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-1 gap-3">
            <label
              className={`relative flex items-start gap-4 p-4 rounded-lg border-2 cursor-pointer transition-all ${
                schedulingMode === 'harbor_driven'
                  ? 'border-teal-500 bg-teal-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <input
                type="radio"
                name="scheduling_mode"
                value="harbor_driven"
                checked={schedulingMode === 'harbor_driven'}
                onChange={() => setSchedulingMode('harbor_driven')}
                className="mt-1 text-teal-600 focus:ring-teal-500"
              />
              <div>
                <p className="text-sm font-semibold text-gray-900">Harbor Drives the Schedule</p>
                <p className="text-xs text-gray-500 mt-1">
                  {practice?.ai_name || 'Your receptionist'} books and reschedules appointments directly.
                  You&apos;ll get a daily recap of all changes. Best for practices that want full automation.
                </p>
              </div>
            </label>
            <label
              className={`relative flex items-start gap-4 p-4 rounded-lg border-2 cursor-pointer transition-all ${
                schedulingMode === 'notification'
                  ? 'border-teal-500 bg-teal-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <input
                type="radio"
                name="scheduling_mode"
                value="notification"
                checked={schedulingMode === 'notification'}
                onChange={() => setSchedulingMode('notification')}
                className="mt-1 text-teal-600 focus:ring-teal-500"
              />
              <div>
                <p className="text-sm font-semibold text-gray-900">Notify Me First</p>
                <p className="text-xs text-gray-500 mt-1">
                  {practice?.ai_name || 'Your receptionist'} collects the request and sends you a notification to confirm.
                  Changes revert if not confirmed within 2 hours. Best for practices that want final say.
                </p>
              </div>
            </label>
          </div>

          {/* Daily Recap Settings */}
          <div className="border-t border-gray-100 pt-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-sm font-medium text-gray-900">Daily Schedule Recap</p>
                <p className="text-xs text-gray-500">Get a summary of all schedule changes and tomorrow&apos;s appointments</p>
              </div>
              <button
                onClick={() => setDailyRecapEnabled(!dailyRecapEnabled)}
                className={`relative w-11 h-6 rounded-full transition-colors ${
                  dailyRecapEnabled ? 'bg-teal-600' : 'bg-gray-300'
                }`}
              >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                  dailyRecapEnabled ? 'translate-x-5' : ''
                }`} />
              </button>
            </div>
            {dailyRecapEnabled && (
              <div className="flex items-center gap-4 ml-0">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Send at</label>
                  <input
                    type="time"
                    value={dailyRecapTime}
                    onChange={e => setDailyRecapTime(e.target.value)}
                    className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Send via</label>
                  <select
                    value={dailyRecapMethod}
                    onChange={e => setDailyRecapMethod(e.target.value as RecapMethod)}
                    className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                  >
                    <option value="email">Email</option>
                    <option value="sms">Text Message</option>
                    <option value="both">Both</option>
                  </select>
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="p-5 border-t border-gray-100 flex justify-end">
          <button
            onClick={handleSchedulingSave}
            disabled={schedulingSaving}
            className="px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 disabled:opacity-50 transition-colors"
          >
            {schedulingSaving ? 'Saving...' : schedulingSaved ? '\u2713 Saved' : 'Save Scheduling Settings'}
          </button>
        </div>
      </div>

      {/* Practice Info */}
      <div className="bg-white rounded-xl border border-gray-200 mb-6">
        <div className="p-5 border-b border-gray-100">
          <h2 className="font-semibold text-gray-700 text-sm uppercase tracking-wide">Practice Info</h2>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Practice Name</label>
            <input
              type="text"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">AI Receptionist Name</label>
            <input
              type="text"
              value={form.ai_name}
              onChange={e => setForm(f => ({ ...f, ai_name: e.target.value }))}
              placeholder="e.g. Ellie"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
            <p className="text-xs text-gray-400 mt-1">The name callers will know your receptionist as</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Practice Phone Number</label>
            <input
              type="tel"
              value={form.phone_number}
              onChange={e => setForm(f => ({ ...f, phone_number: e.target.value }))}
              placeholder="+15415394890"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
            <p className="text-xs text-gray-400 mt-1">The Twilio number patients call (format: +15415394890)</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Fax Number</label>
            <input
              type="tel"
              value={form.fax_number}
              onChange={e => setForm(f => ({ ...f, fax_number: e.target.value }))}
              placeholder="(541) 555-1212"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
            <p className="text-xs text-gray-400 mt-1">If you have a fax line, Ellie shares this when callers ask to fax Release of Information forms or records. Leave blank if you don't accept fax.</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Timezone</label>
            <select
              value={form.timezone}
              onChange={e => setForm(f => ({ ...f, timezone: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
            >
              {TIMEZONES.map(tz => (<option key={tz} value={tz}>{tz}</option>))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Insurance Accepted</label>
            <input
              type="text"
              value={form.insurance_accepted}
              onChange={e => setForm(f => ({ ...f, insurance_accepted: e.target.value }))}
              placeholder="Aetna, Blue Cross, Cigna, United, Private Pay"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
            <p className="text-xs text-gray-400 mt-1">Comma-separated — your AI receptionist will mention these to callers who ask</p>
          </div>
          <div className="pt-4 mt-4 border-t border-gray-100">
            <div className="text-sm font-semibold text-gray-900">Billing identifiers</div>
            <p className="text-xs text-gray-500 mt-1 mb-3">
              Required for insurance eligibility checks and any future claim submission. Ask your biller or check your NPPES record if you&apos;re unsure.
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Billing NPI</label>
            <input
              type="text"
              inputMode="numeric"
              maxLength={10}
              value={form.npi}
              onChange={e => setForm(f => ({ ...f, npi: e.target.value.replace(/\D/g, '').slice(0, 10) }))}
              placeholder="10-digit NPI"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 font-mono"
            />
            <p className="text-xs text-gray-400 mt-1">
              Used as the billing provider on every Stedi eligibility request.
              {form.npi && form.npi.length !== 10 && (
                <span className="ml-1 text-amber-700">NPI must be 10 digits.</span>
              )}
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Tax ID (EIN)</label>
            <input
              type="text"
              inputMode="numeric"
              maxLength={9}
              value={form.tax_id}
              onChange={e => setForm(f => ({ ...f, tax_id: e.target.value.replace(/\D/g, '').slice(0, 9) }))}
              placeholder="9-digit EIN (optional for eligibility)"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 font-mono"
            />
            <p className="text-xs text-gray-400 mt-1">Required when we add claim submission. Optional today.</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Call Summary Notification Emails</label>
            <input
              type="text"
              value={form.notification_emails}
              onChange={e => setForm(f => ({ ...f, notification_emails: e.target.value }))}
              placeholder="therapist@email.com, owner@email.com, admin@email.com"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
            <p className="text-xs text-gray-400 mt-1">Comma-separated — everyone listed gets an email after each call</p>
          </div>
        </div>
        <div className="p-5 border-t border-gray-100 flex items-center justify-between">
          <div>
            {error && <p className="text-xs text-red-600">{error}</p>}
            {!error && <p className="text-xs text-gray-400">Saving updates your receptionist&apos;s knowledge in real time</p>}
          </div>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving...' : saved ? '\u2713 Saved' : 'Save Changes'}
          </button>
        </div>
      </div>

      {/* Office Hours */}
      <div className="bg-white rounded-xl border border-gray-200 mb-6">
        <div className="p-5 border-b border-gray-100">
          <h2 className="font-semibold text-gray-700 text-sm uppercase tracking-wide">Office Hours</h2>
          <p className="text-xs text-gray-400 mt-1">{practice?.ai_name || 'Your receptionist'} will tell callers your hours and adjust behavior for after-hours calls</p>
        </div>
        <div className="p-5 space-y-2">
          {DAYS.map((day) => (
            <div key={day} className="flex items-center gap-3">
              <button
                onClick={() => updateHours(day, 'enabled', !hours[day].enabled)}
                className={`relative w-10 h-5 rounded-full transition-colors shrink-0 cursor-pointer ${
                  hours[day].enabled ? 'bg-teal-600' : 'bg-gray-300'
                }`}
              >
                <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                  hours[day].enabled ? 'translate-x-5' : ''
                }`} />
              </button>
              <span className={`text-sm font-medium w-24 ${hours[day].enabled ? 'text-gray-900' : 'text-gray-400'}`}>
                {DAY_LABELS[day]}
              </span>
              {hours[day].enabled ? (
                <div className="flex items-center gap-2">
                  <input
                    type="time"
                    value={hours[day].openTime}
                    onChange={(e) => updateHours(day, 'openTime', e.target.value)}
                    className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                  <span className="text-gray-400 text-sm">to</span>
                  <input
                    type="time"
                    value={hours[day].closeTime}
                    onChange={(e) => updateHours(day, 'closeTime', e.target.value)}
                    className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </div>
              ) : (
                <span className="text-gray-400 text-sm">Closed</span>
              )}
            </div>
          ))}
        </div>
        <div className="p-5 border-t border-gray-100 flex justify-end">
          <button
            onClick={handleHoursSave}
            disabled={hoursSaving}
            className="px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 disabled:opacity-50 transition-colors"
          >
            {hoursSaving ? 'Saving...' : hoursSaved ? '\u2713 Saved' : 'Save Hours'}
          </button>
        </div>
      </div>

      {/* AI Greeting */}
      <div className="bg-white rounded-xl border border-gray-200 mb-6">
        <div className="p-5 border-b border-gray-100">
          <h2 className="font-semibold text-gray-700 text-sm uppercase tracking-wide">AI Greeting</h2>
          <p className="text-xs text-gray-400 mt-1">The first thing callers hear when {practice?.ai_name || 'your receptionist'} picks up</p>
        </div>
        <div className="p-5 space-y-3">
          <textarea
            value={greeting}
            onChange={e => setGreeting(e.target.value)}
            rows={3}
            placeholder={`Thank you for calling ${practice?.name || 'our practice'}. This is ${practice?.ai_name || 'Ellie'}, how can I help you today?`}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none"
          />
          <p className="text-xs text-gray-400">
            Tip: Keep it warm and natural. Include your practice name and {practice?.ai_name || 'your receptionist'}&apos;s name so callers know who they&apos;re talking to.
          </p>
          {!greeting && (
            <button
              onClick={() => setGreeting(`Thank you for calling ${practice?.name || 'our practice'}. This is ${practice?.ai_name || 'Ellie'}, how can I help you today?`)}
              className="text-xs text-teal-600 hover:text-teal-700 font-medium"
            >
              Use default greeting
            </button>
          )}
        </div>
        <div className="p-5 border-t border-gray-100 flex justify-end">
          <button
            onClick={handleGreetingSave}
            disabled={greetingSaving}
            className="px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 disabled:opacity-50 transition-colors"
          >
            {greetingSaving ? 'Saving...' : greetingSaved ? '\u2713 Saved' : 'Save Greeting'}
          </button>
        </div>
      </div>

      {/* Therapists */}
      <div className="bg-white rounded-xl border border-gray-200 mb-6">
        <div className="p-5 border-b border-gray-100 flex items-center justify-between gap-4">
          <div>
            <h2 className="font-semibold text-gray-700 text-sm uppercase tracking-wide">Therapists</h2>
            <p className="text-xs text-gray-400 mt-1">Clinicians at this practice. Their bios help {practice?.ai_name || 'your receptionist'} talk knowledgeably about them on calls.</p>
          </div>
          <button
            onClick={openTherapistModalForNew}
            className="px-3 py-1.5 text-xs font-medium text-teal-700 border border-teal-200 rounded-lg hover:bg-teal-50 whitespace-nowrap"
          >
            + Add Therapist
          </button>
        </div>
        <div className="p-5">
          {therapistsLoading ? (
            <p className="text-sm text-gray-400">Loading...</p>
          ) : therapists.length === 0 ? (
            <div className="text-sm text-gray-500 p-4 bg-gray-50 rounded-lg border border-gray-200">
              No therapists yet. Add the therapist (or therapists) practicing under {practice?.name || 'this practice'} so {practice?.ai_name || 'your receptionist'} can reference them on calls.
            </div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {therapists.map(t => (
                <li key={t.id} className="py-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-sm font-medium ${t.is_active ? 'text-gray-900' : 'text-gray-400 line-through'}`}>
                        {t.display_name}
                      </span>
                      {t.credentials && (
                        <span className="text-xs text-gray-500">{t.credentials}</span>
                      )}
                      {t.is_primary && t.is_active && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-teal-50 text-teal-700 border border-teal-200">Primary</span>
                      )}
                      {!t.is_active && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500 border border-gray-200">Inactive</span>
                      )}
                    </div>
                    {t.bio && (
                      <p className="text-xs text-gray-500 mt-1 line-clamp-2">{t.bio}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => openTherapistModalForEdit(t)}
                      className="text-xs font-medium text-teal-700 hover:text-teal-900"
                    >
                      Edit
                    </button>
                    {t.is_active && (
                      <button
                        onClick={() => handleTherapistDelete(t.id)}
                        className="text-xs text-gray-400 hover:text-red-600"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Intake Form Configuration */}
      <div className="bg-white rounded-xl border border-gray-200 mb-6">
        <div className="p-5 border-b border-gray-100">
          <h2 className="font-semibold text-gray-700 text-sm uppercase tracking-wide">Intake Form Sections</h2>
          <p className="text-xs text-gray-400 mt-1">Choose which sections patients see when they fill out intake paperwork</p>
        </div>
        <div className="p-5 space-y-3">
          {[
            { key: 'demographics', label: 'Demographics', desc: 'Name, DOB, address, phone, email, emergency contact, pronouns', locked: true },
            { key: 'insurance', label: 'Insurance Information', desc: 'Provider, policy number, group number, subscriber details' },
            { key: 'presenting_concerns', label: 'Reason for Seeking Therapy', desc: 'Primary concerns, goals for therapy, symptom timeline, previous coping strategies' },
            { key: 'medications', label: 'Current Medications', desc: 'Medication list with dosage, prescriber, and how long taking each' },
            { key: 'medical_history', label: 'Medical History', desc: 'Current conditions, past surgeries/hospitalizations, allergies, primary care physician' },
            { key: 'prior_therapy', label: 'Prior Mental Health Treatment', desc: 'Previous therapists/psychiatrists, treatment types, what helped or didn\'t' },
            { key: 'substance_use', label: 'Substance Use Screening', desc: 'Alcohol, tobacco, cannabis, other substance use frequency and concerns' },
            { key: 'family_history', label: 'Family Mental Health History', desc: 'Mental health conditions in immediate family members' },
            { key: 'phq9', label: 'PHQ-9 (Depression Screening)', desc: '9-item standardized depression questionnaire with severity scoring' },
            { key: 'gad7', label: 'GAD-7 (Anxiety Screening)', desc: '7-item standardized anxiety questionnaire with severity scoring' },
            { key: 'consent', label: 'Consent & Signatures', desc: 'Document acknowledgment, e-signatures, and treatment consent', locked: true },
            { key: 'additional_notes', label: 'Additional Notes', desc: 'Open text field for anything else the patient wants to share' },
          ].map(({ key, label, desc, locked }) => (
            <div key={key} className="flex items-start gap-3 py-2">
              <button
                onClick={() => {
                  if (locked) return
                  setIntakeConfig(prev => ({ ...prev, [key]: !prev[key] }))
                }}
                className={`relative mt-0.5 w-10 h-5 rounded-full transition-colors shrink-0 ${
                  locked ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'
                } ${intakeConfig[key] ? 'bg-teal-600' : 'bg-gray-300'}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                  intakeConfig[key] ? 'translate-x-5' : ''
                }`} />
              </button>
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900">
                  {label}
                  {locked && <span className="text-xs text-gray-400 ml-2">(always on)</span>}
                </p>
                <p className="text-xs text-gray-500">{desc}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="p-5 border-t border-gray-100 flex justify-end">
          <button
            onClick={handleIntakeConfigSave}
            disabled={intakeSaving}
            className="px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 disabled:opacity-50 transition-colors"
          >
            {intakeSaving ? 'Saving...' : intakeSaved ? '\u2713 Saved' : 'Save Intake Settings'}
          </button>
        </div>
      </div>
        </>
      )}

      {/* Crisis Resources — per-practice referral list Ellie reads to callers
          in crisis, and toggle for whether this practice provides clinical
          crisis intervention. Critical for non-crisis-capable providers:
          when OFF, Ellie routes to 988 + local resources and does not
          promise therapist callback for crisis. */}
      <div className="bg-white rounded-xl border border-gray-200 mb-6">
        <div className="p-5 border-b border-gray-100">
          <h2 className="font-semibold text-gray-700 text-sm uppercase tracking-wide">Crisis Resources</h2>
          <p className="text-xs text-gray-400 mt-1">Ellie reads these to callers who show signs of crisis, one at a time with pauses in between. Every crisis call also triggers an email to your notification address and an SMS to the practice phone on file.</p>
        </div>
        <div className="p-5 space-y-5">

          <label className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-lg cursor-pointer">
            <input
              type="checkbox"
              checked={isCrisisCapable}
              disabled={crisisCapableSaving}
              onChange={e => toggleCrisisCapable(e.target.checked)}
              className="mt-1 h-4 w-4 rounded border-amber-300 text-teal-600 focus:ring-teal-500"
            />
            <span className="text-sm text-amber-900">
              <strong>I provide clinical crisis intervention.</strong> Leave OFF if you do not &mdash; Ellie will route callers to 988 + the local resources below without implying you&rsquo;ll call back for crisis response. Only turn this ON if you are trained and available for crisis work.
            </span>
          </label>

          {crisisResourcesLoading ? (
            <div className="text-sm text-gray-400">Loading resources&hellip;</div>
          ) : (
            <>
              {crisisResources.length > 0 ? (
                <div className="space-y-2">
                  {crisisResources.map(r => (
                    <div key={r.id} className="flex items-start justify-between gap-3 p-3 border border-gray-200 rounded-lg">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-900">{r.name}{r.is_primary ? <span className="ml-2 text-xs text-teal-600">(primary)</span> : null}</p>
                        {r.phone && <p className="text-xs text-gray-600">Call: {r.phone}</p>}
                        {r.text_line && <p className="text-xs text-gray-600">Text: {r.text_line}</p>}
                        {r.availability && <p className="text-xs text-gray-500">Hours: {r.availability}</p>}
                        {r.coverage_area && <p className="text-xs text-gray-500">Area: {r.coverage_area}</p>}
                        {r.description && <p className="text-xs text-gray-500 mt-1">{r.description}</p>}
                      </div>
                      <button
                        onClick={() => deleteCrisisResource(r.id)}
                        className="text-xs text-red-600 hover:text-red-800 underline shrink-0"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-gray-400 italic">No local crisis resources yet. Ellie will always refer to 988; add local options below if you want her to mention them too.</div>
              )}

              <div className="border border-dashed border-gray-300 rounded-lg p-4 space-y-3">
                <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Add a crisis resource</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    type="text"
                    placeholder="Name (e.g. Klamath County Crisis Line)"
                    value={crisisDraft.name || ''}
                    onChange={e => setCrisisDraft(d => ({...d, name: e.target.value}))}
                    className="border border-gray-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-teal-400"
                  />
                  <input
                    type="tel"
                    placeholder="Phone (e.g. 541-883-1030)"
                    value={crisisDraft.phone || ''}
                    onChange={e => setCrisisDraft(d => ({...d, phone: e.target.value}))}
                    className="border border-gray-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-teal-400"
                  />
                  <input
                    type="text"
                    placeholder="Text line (optional)"
                    value={crisisDraft.text_line || ''}
                    onChange={e => setCrisisDraft(d => ({...d, text_line: e.target.value}))}
                    className="border border-gray-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-teal-400"
                  />
                  <input
                    type="text"
                    placeholder="Hours (e.g. 24/7 or M-F 8-5)"
                    value={crisisDraft.availability || ''}
                    onChange={e => setCrisisDraft(d => ({...d, availability: e.target.value}))}
                    className="border border-gray-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-teal-400"
                  />
                </div>
                <input
                  type="text"
                  placeholder="Short description (what makes this resource useful)"
                  value={crisisDraft.description || ''}
                  onChange={e => setCrisisDraft(d => ({...d, description: e.target.value}))}
                  className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-teal-400"
                />
                <button
                  onClick={addCrisisResource}
                  disabled={!crisisDraft.name || savingCrisis}
                  className="px-4 py-2 text-xs font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:bg-gray-300 rounded-lg"
                >
                  {savingCrisis ? 'Adding\u2026' : 'Add Resource'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
        </>
      )}

      {activeTab === 'calendar' && (
        <>

      {/* Calendar Sync — THE primary calendar solution */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <h2 className="font-semibold text-gray-700 text-sm uppercase tracking-wide">Sync to Your Calendar</h2>
        <p className="text-sm text-gray-500 mt-1 mb-4">
          Add Harbor appointments to your existing calendar. Works with Apple Calendar, Google Calendar, and Outlook — one click, no passwords needed.
        </p>

        {calLoading ? (
          <div className="text-sm text-gray-400">Loading...</div>
        ) : !calToken ? (
          <button
            onClick={generateCalToken}
            disabled={calGenerating}
            className="px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 disabled:opacity-50 transition-colors"
          >
            {calGenerating ? 'Generating...' : 'Generate Calendar Link'}
          </button>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-col sm:flex-row gap-4 items-start">
              <div className="flex-1 min-w-0 w-full">
                <div className="flex flex-wrap gap-3">
                  <a
                    href={(calFeedUrl || '').replace('https://', 'webcal://')}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    Open in Apple Calendar
                  </a>
                  <button
                    onClick={copyCalUrl}
                    className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    {calCopied ? '\u2713 Copied!' : 'Copy Link'}
                  </button>
                </div>
                <p className="text-xs text-gray-400 mt-3">
                  Works with Apple Calendar, Google Calendar, and Outlook.
                </p>
                <button
                  onClick={regenerateCalToken}
                  className="text-xs text-red-400 hover:text-red-600 mt-3"
                >
                  Regenerate Link (breaks existing subscriptions)
                </button>
              </div>
              {/* QR code — scannable by the therapist's phone camera, opens
                  the native calendar "Subscribe" prompt instantly. Endpoint
                  is session-authed + honors admin act-as cookie. */}
              <div className="flex flex-col items-center gap-2 shrink-0 self-start">
                <img
                  src={`/api/calendar/ics-qr?v=${calFeedUrl ? encodeURIComponent(calFeedUrl) : ''}`}
                  alt="QR code for Harbor calendar subscription"
                  className="w-32 h-32 rounded-lg border border-gray-200 bg-white p-1"
                />
                <p className="text-xs text-gray-400">Scan on phone</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Advanced Calendar Integrations */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="p-5 border-b border-gray-100">
          <h2 className="font-semibold text-gray-700 text-sm uppercase tracking-wide">Advanced: Direct Calendar Access</h2>
          <p className="text-xs text-gray-400 mt-1">Optional — connect directly so {practice?.ai_name || 'your receptionist'} can check your availability before booking</p>
        </div>
        <div className="p-5 space-y-5">

          {/* Apple Calendar (iCloud) */}
          <div>
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-lg bg-white border border-gray-200 flex items-center justify-center shadow-sm shrink-0">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <rect x="2" y="4" width="20" height="18" rx="3" fill="#FF3B30"/>
                    <rect x="2" y="4" width="20" height="6" rx="3" fill="#FF3B30"/>
                    <rect x="2" y="8" width="20" height="14" rx="0" fill="white"/>
                    <rect x="6.5" y="1.5" width="2" height="5" rx="1" fill="#FF3B30"/>
                    <rect x="15.5" y="1.5" width="2" height="5" rx="1" fill="#FF3B30"/>
                    <text x="12" y="18.5" textAnchor="middle" fontSize="7" fontWeight="700" fill="#FF3B30" fontFamily="sans-serif">17</text>
                  </svg>
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900">Apple Calendar (iCloud)</p>
                  {appleCalLoading ? (
                    <p className="text-xs text-gray-400">Checking connection&hellip;</p>
                  ) : appleCal?.connected ? (
                    <p className="text-xs text-green-600 truncate">Connected &middot; {appleCal.username}{appleCal.calendarCount ? ` &middot; ${appleCal.calendarCount} calendar${appleCal.calendarCount > 1 ? 's' : ''}` : ''}</p>
                  ) : (
                    <p className="text-xs text-gray-400">Read &amp; write access to your iCloud calendar</p>
                  )}
                </div>
              </div>
              <div className="shrink-0">
                {appleCalLoading ? (
                  <div className="w-5 h-5 border-2 border-teal-400 border-t-transparent rounded-full animate-spin" />
                ) : appleCal?.connected ? (
                  <button
                    onClick={disconnectAppleCal}
                    disabled={appleCalDisconnecting}
                    className="px-3 py-1.5 text-xs font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50 transition-colors"
                  >
                    {appleCalDisconnecting ? 'Disconnecting\u2026' : 'Disconnect'}
                  </button>
                ) : (
                  <button
                    onClick={() => setShowAppleCalForm(!showAppleCalForm)}
                    className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors whitespace-nowrap"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83" fill="#333"/>
                      <path d="M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" fill="#333"/>
                    </svg>
                    Connect Apple Calendar
                  </button>
                )}
              </div>
            </div>

            {/* Apple Calendar connect form */}
            {showAppleCalForm && !appleCal?.connected && (
              <div className="mt-3 ml-13 p-4 bg-gray-50 rounded-lg border border-gray-200 space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Apple ID Email</label>
                  <input
                    type="email"
                    value={appleCalForm.appleId}
                    onChange={e => setAppleCalForm(f => ({ ...f, appleId: e.target.value }))}
                    placeholder="yourname@icloud.com"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">App-Specific Password</label>
                  <input
                    type="password"
                    value={appleCalForm.appPassword}
                    onChange={e => setAppleCalForm(f => ({ ...f, appPassword: e.target.value }))}
                    placeholder="xxxx-xxxx-xxxx-xxxx"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                  <p className="text-xs text-gray-400 mt-1">
                    Generate one at{' '}
                    <a href="https://appleid.apple.com/account/manage" target="_blank" rel="noopener noreferrer" className="text-teal-600 hover:underline">
                      appleid.apple.com
                    </a>
                    {' '}&rarr; Sign-In &amp; Security &rarr; App-Specific Passwords
                  </p>
                </div>
                {appleCalError && (
                  <p className="text-xs text-red-600">{appleCalError}</p>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={connectAppleCal}
                    disabled={appleCalConnecting}
                    className="px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 disabled:opacity-50 transition-colors"
                  >
                    {appleCalConnecting ? 'Connecting...' : 'Connect'}
                  </button>
                  <button
                    onClick={() => { setShowAppleCalForm(false); setAppleCalError(null) }}
                    className="px-4 py-2 text-sm font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Divider */}
          <div className="border-t border-gray-100" />

          {/* Google Calendar */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-lg bg-white border border-gray-200 flex items-center justify-center shadow-sm shrink-0">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <rect x="2" y="4" width="20" height="18" rx="2" fill="white" stroke="#e0e0e0" strokeWidth="1.2"/>
                  <rect x="2" y="4" width="20" height="6" rx="2" fill="#1a73e8"/>
                  <rect x="2" y="8" width="20" height="2" fill="#1a73e8"/>
                  <rect x="6.5" y="1.5" width="2" height="5" rx="1" fill="#5f6368"/>
                  <rect x="15.5" y="1.5" width="2" height="5" rx="1" fill="#5f6368"/>
                  <text x="12" y="19" textAnchor="middle" fontSize="6.5" fontWeight="700" fill="#1a73e8" fontFamily="sans-serif">CAL</text>
                </svg>
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900">Google Calendar</p>
                {gcalLoading ? (
                  <p className="text-xs text-gray-400">Checking connection&hellip;</p>
                ) : gcal?.connected ? (
                  <p className="text-xs text-green-600 truncate">Connected &middot; {gcal.email}</p>
                ) : (
                  <p className="text-xs text-gray-400">Read &amp; write access via Google OAuth</p>
                )}
              </div>
            </div>
            <div className="shrink-0">
              {gcalLoading ? (
                <div className="w-5 h-5 border-2 border-teal-400 border-t-transparent rounded-full animate-spin" />
              ) : gcal?.connected ? (
                <button
                  onClick={disconnectGcal}
                  disabled={gcalDisconnecting}
                  className="px-3 py-1.5 text-xs font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50 transition-colors"
                >
                  {gcalDisconnecting ? 'Disconnecting\u2026' : 'Disconnect'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => { setGcalAttestWorkspace(false); setGcalAttestBaa(false); setGcalBaaModalOpen(true) }}
                  className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors whitespace-nowrap"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                  Connect Google Calendar
                </button>
              )}
            </div>
          </div>

          {/* HIPAA BAA attestation modal — gate before Google OAuth handoff.
              Calendar events carry patient name + time (PHI). Google only
              signs a BAA for paid Workspace plans where the admin has
              accepted the BAA in the admin console. We refuse to connect
              without both attestations from the practice owner. */}
          {gcalBaaModalOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
              <div className="bg-white rounded-2xl max-w-lg w-full shadow-xl p-6">
                <h3 className="text-lg font-semibold text-gray-900">Before connecting Google Calendar</h3>
                <p className="mt-2 text-sm text-gray-600">
                  Harbor writes patient appointment details (name + time) to your calendar. That is
                  Protected Health Information. Google only covers PHI under HIPAA for paid
                  <strong> Google Workspace</strong> plans where your admin has
                  <strong> accepted Google&rsquo;s BAA</strong>. Free <code className="text-xs bg-gray-100 px-1 rounded">@gmail.com</code> accounts are not covered.
                </p>
                <p className="mt-3 text-sm text-gray-600">
                  If you are not sure, <strong>skip this</strong> and use Harbor&rsquo;s dashboard
                  directly — you can save it to your phone&rsquo;s home screen like an app.
                </p>
                <div className="mt-4 space-y-3">
                  <label className="flex items-start gap-2 text-sm text-gray-800 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={gcalAttestWorkspace}
                      onChange={e => setGcalAttestWorkspace(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-gray-300 text-teal-600 focus:ring-teal-500"
                    />
                    <span>
                      My Google account is a paid <strong>Google Workspace</strong> plan (Business Starter or higher), not free Gmail.
                    </span>
                  </label>
                  <label className="flex items-start gap-2 text-sm text-gray-800 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={gcalAttestBaa}
                      onChange={e => setGcalAttestBaa(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-gray-300 text-teal-600 focus:ring-teal-500"
                    />
                    <span>
                      My Workspace admin has signed the Google Workspace BAA in the admin console.{' '}
                      <a
                        href="https://support.google.com/a/answer/3407054"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-teal-600 underline"
                      >
                        How to sign Google&rsquo;s BAA
                      </a>
                    </span>
                  </label>
                </div>
                <div className="mt-6 flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
                  <button
                    type="button"
                    onClick={() => setGcalBaaModalOpen(false)}
                    className="px-4 py-2 text-sm font-medium text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <a
                    aria-disabled={!(gcalAttestWorkspace && gcalAttestBaa)}
                    href={gcalAttestWorkspace && gcalAttestBaa ? '/api/integrations/google-calendar/auth?baa_attested=1' : '#'}
                    onClick={e => {
                      if (!(gcalAttestWorkspace && gcalAttestBaa)) { e.preventDefault() }
                    }}
                    className={`px-4 py-2 text-sm font-medium text-white rounded-lg text-center ${
                      gcalAttestWorkspace && gcalAttestBaa
                        ? 'bg-teal-600 hover:bg-teal-700'
                        : 'bg-gray-300 cursor-not-allowed'
                    }`}
                  >
                    Continue to Google
                  </a>
                </div>
                <p className="mt-4 text-xs text-gray-400">
                  By checking the boxes above you confirm these statements are accurate. Harbor records
                  your attestation timestamp for our compliance audit.
                </p>
              </div>
            </div>
          )}

        </div>
      </div>
        </>
      )}

      {activeTab === 'billing' && (
        <>
          <div className="bg-white rounded-xl border border-gray-200 mb-6">
            <div className="p-5 border-b border-gray-100">
              <h2 className="font-semibold text-gray-700 text-sm uppercase tracking-wide">Self-Pay Rate</h2>
              <p className="text-xs text-gray-400 mt-1">Default session rate for patients paying out of pocket. Leave blank to defer pricing to the therapist.</p>
            </div>
            <div className="p-5 space-y-3">
              <label className="block text-sm font-medium text-gray-700 mb-1">Session rate</label>
              <div className="relative max-w-xs">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={selfPayRate}
                  onChange={e => setSelfPayRate(e.target.value)}
                  placeholder="150.00"
                  className="w-full pl-7 pr-12 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs">USD</span>
              </div>
              <p className="text-xs text-gray-400">
                Used when a patient&apos;s billing mode is set to self-pay. Sliding-scale overrides (per patient) will live on the patient detail page.
              </p>
              {selfPayRateError && <p className="text-xs text-red-600">{selfPayRateError}</p>}
            </div>
            <div className="p-5 border-t border-gray-100 flex justify-end">
              <button
                onClick={handleSelfPayRateSave}
                disabled={selfPayRateSaving}
                className="px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 disabled:opacity-50 transition-colors"
              >
                {selfPayRateSaving ? 'Saving...' : selfPayRateSaved ? '\u2713 Saved' : 'Save Rate'}
              </button>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 mb-6">
            <div className="p-5 border-b border-gray-100">
              <h2 className="font-semibold text-gray-700 text-sm uppercase tracking-wide">Billing Mode Management</h2>
              <p className="text-xs text-gray-400 mt-1">Track which patients are on insurance vs. self-pay</p>
            </div>
            <div className="p-5">
              <div className="rounded-lg bg-gray-50 border border-gray-200 p-4 text-sm text-gray-600">
                Per-patient billing mode (pending, insurance, self-pay, sliding-scale) is tracked in the database. To switch a patient&apos;s mode, open the patient&apos;s detail page and use the billing-mode control there.
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
