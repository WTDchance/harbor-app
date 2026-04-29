// app/portal/settings/notifications/page.tsx — Wave 50.
//
// Patient-facing notification-preference toggles. Backed by:
//   GET  /api/portal/notifications  → current state
//   PUT  /api/portal/notifications  → update
//
// account_creation and password_reset are intentionally NOT shown — those
// are security-critical and never opt-out-able. The UI mirrors that
// invariant in the explainer text.

'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { useRouter } from 'next/navigation'

type Prefs = {
  appointment_reminders_enabled: boolean
  intake_invitations_enabled: boolean
  custom_form_invitations_enabled: boolean
  payment_receipts_enabled: boolean
}

const TOGGLES: Array<{
  key: keyof Prefs
  label: string
  description: string
}> = [
  {
    key: 'appointment_reminders_enabled',
    label: 'Appointment reminders & confirmations',
    description:
      'Reminders 24 hours and 2 hours before your appointment, plus confirmations and cancellations.',
  },
  {
    key: 'intake_invitations_enabled',
    label: 'Intake form invitations',
    description:
      'Welcome emails with a secure link to complete intake forms before your first appointment.',
  },
  {
    key: 'custom_form_invitations_enabled',
    label: 'Custom form invitations',
    description:
      'Notifications when your provider sends you a form to fill out (assessments, questionnaires).',
  },
  {
    key: 'payment_receipts_enabled',
    label: 'Payment receipts',
    description:
      'Receipts confirming payments and copays. Recommended for tax and insurance records.',
  },
]

export default function PortalNotificationsPage() {
  const router = useRouter()
  const [prefs, setPrefs] = useState<Prefs | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const res = await fetch('/api/portal/notifications')
      if (res.status === 401) { router.replace('/portal/login'); return }
      if (!res.ok) {
        if (!cancelled) setError('Failed to load preferences.')
        return
      }
      const json = await res.json()
      if (!cancelled) setPrefs(json.prefs)
    })()
    return () => { cancelled = true }
  }, [router])

  async function toggle(key: keyof Prefs) {
    if (!prefs) return
    const next = { ...prefs, [key]: !prefs[key] }
    setPrefs(next)
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/portal/notifications', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      })
      if (!res.ok) throw new Error('Failed to save.')
      setSavedAt(Date.now())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed.')
      // Revert optimistic update.
      setPrefs(prefs)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '24px 20px' }}>
      <Link
        href="/portal/home"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#0d5c4b', textDecoration: 'none', fontSize: 14, marginBottom: 16 }}
      >
        <ChevronLeft size={16} /> Back
      </Link>
      <h1 style={{ fontSize: 24, fontWeight: 600, margin: '0 0 8px' }}>
        Notification preferences
      </h1>
      <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 28, lineHeight: 1.6 }}>
        Choose which emails you'd like to receive. Security-critical messages
        (password resets, account confirmations) are always sent and can't be
        turned off.
      </p>

      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', padding: 12, borderRadius: 8, marginBottom: 16, fontSize: 14 }}>
          {error}
        </div>
      )}

      {!prefs ? (
        <p style={{ color: '#9ca3af' }}>Loading…</p>
      ) : (
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', overflow: 'hidden' }}>
          {TOGGLES.map((t, i) => (
            <div
              key={t.key}
              style={{
                padding: '18px 20px',
                borderTop: i === 0 ? 'none' : '1px solid #f3f4f6',
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                gap: 16,
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>{t.label}</div>
                <div style={{ color: '#6b7280', fontSize: 13, lineHeight: 1.5 }}>{t.description}</div>
              </div>
              <button
                type="button"
                onClick={() => toggle(t.key)}
                disabled={saving}
                aria-pressed={prefs[t.key]}
                style={{
                  appearance: 'none',
                  border: 'none',
                  width: 48,
                  height: 28,
                  borderRadius: 14,
                  background: prefs[t.key] ? '#0d5c4b' : '#d1d5db',
                  position: 'relative',
                  cursor: saving ? 'wait' : 'pointer',
                  transition: 'background 0.15s',
                  flexShrink: 0,
                }}
              >
                <span
                  style={{
                    position: 'absolute',
                    top: 3,
                    left: prefs[t.key] ? 23 : 3,
                    width: 22,
                    height: 22,
                    borderRadius: '50%',
                    background: '#fff',
                    transition: 'left 0.15s',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                  }}
                />
              </button>
            </div>
          ))}
        </div>
      )}

      {savedAt && (
        <p style={{ color: '#10b981', fontSize: 13, marginTop: 12 }}>Saved.</p>
      )}

      <p style={{ color: '#9ca3af', fontSize: 12, marginTop: 24, lineHeight: 1.6 }}>
        These preferences only affect emails. Your provider may still call or
        text you using their preferred contact method.
      </p>
    </div>
  )
}
