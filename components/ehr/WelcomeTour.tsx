// components/ehr/WelcomeTour.tsx
// Minimal first-time tour for a new EHR practice. Shows a dismissible
// overlay on the first /dashboard/ehr/* visit with 5 quick cards:
// what Harbor EHR is, where to start, and where the magic lives.
//
// Dismissal is stored in localStorage (per-browser) so it never re-appears
// for the same user on the same machine. The "Start with Sample Patient"
// CTA drops the user into the seeded patient's profile.

'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Sparkles, X, ChevronRight, ChevronLeft } from 'lucide-react'

const KEY = 'harbor_ehr_welcome_tour_dismissed_v1'

const STEPS = [
  {
    title: 'Welcome to Harbor EHR',
    body: 'Notes, assessments, billing, and a patient portal — all in one place. Designed around how therapists actually work, not how billing companies want you to work.',
    cta: 'What makes it different',
  },
  {
    title: 'AI you can trust',
    body: 'Claude drafts progress notes from a dictated brief or a call transcript. A pre-session briefing card summarizes every patient in 15 seconds. You stay the clinician — the AI saves you typing.',
    cta: 'How the AI works',
  },
  {
    title: 'Your patients will love the portal',
    body: 'Secure messaging, daily check-ins, PHQ-9 on their phone, pay invoices, request appointments, download insurance superbills — from any device.',
    cta: 'Portal features',
  },
  {
    title: 'Shaped for your practice',
    body: 'Pick a preset — Solo simple, Solo data-driven, Small practice balanced, Large practice full operations — and Harbor shrinks or expands to match. Turn individual features off whenever you want.',
    cta: 'Settings → Preferences',
  },
  {
    title: 'Start with Sample Patient',
    body: 'We seeded a test patient with sessions, assessments, mood logs, and open homework. Poke around; nothing you do affects real patients.',
    cta: 'Open Sample Patient',
  },
]

export function WelcomeTour() {
  const [visible, setVisible] = useState(false)
  const [step, setStep] = useState(0)

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      if (!window.localStorage.getItem(KEY)) setVisible(true)
    } catch {}
  }, [])

  function dismiss() {
    try { window.localStorage.setItem(KEY, '1') } catch {}
    setVisible(false)
  }

  if (!visible) return null

  const s = STEPS[step]
  const isLast = step === STEPS.length - 1

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40 p-4" onClick={dismiss}>
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 relative" onClick={(e) => e.stopPropagation()}>
        <button onClick={dismiss}
          className="absolute top-3 right-3 text-gray-400 hover:text-gray-600">
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2 mb-3">
          <div className="w-8 h-8 rounded-full bg-teal-600 flex items-center justify-center text-white">
            <Sparkles className="w-4 h-4" />
          </div>
          <span className="text-xs uppercase tracking-wider text-teal-700 font-semibold">
            Step {step + 1} of {STEPS.length}
          </span>
        </div>

        <h2 className="text-xl font-semibold text-gray-900 mb-2">{s.title}</h2>
        <p className="text-sm text-gray-700 leading-relaxed mb-5">{s.body}</p>

        <div className="flex items-center justify-between gap-2">
          <button
            onClick={() => setStep(Math.max(0, step - 1))}
            disabled={step === 0}
            className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 disabled:opacity-30"
          >
            <ChevronLeft className="w-4 h-4" />
            Back
          </button>
          <div className="flex items-center gap-1">
            {STEPS.map((_, i) => (
              <span key={i} className={`h-1 rounded-full ${i === step ? 'w-6 bg-teal-600' : 'w-1.5 bg-gray-200'}`} />
            ))}
          </div>
          {isLast ? (
            <Link
              href={`/dashboard/patients/00000000-0000-0000-0000-00000000ED10`}
              onClick={dismiss}
              className="inline-flex items-center gap-1 text-sm bg-teal-600 hover:bg-teal-700 text-white font-medium px-4 py-2 rounded-lg"
            >
              {s.cta}
              <ChevronRight className="w-4 h-4" />
            </Link>
          ) : (
            <button
              onClick={() => setStep(step + 1)}
              className="inline-flex items-center gap-1 text-sm bg-teal-600 hover:bg-teal-700 text-white font-medium px-4 py-2 rounded-lg"
            >
              Next
              <ChevronRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
