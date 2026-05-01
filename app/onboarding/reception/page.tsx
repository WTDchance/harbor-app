// app/onboarding/reception/page.tsx
//
// W51 D5 — 4-step Reception onboarding wizard.

'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface State {
  step_calendar_done: string | null
  step_greeting_done: string | null
  step_phone_done: string | null
  step_test_call_done: string | null
  is_live: boolean
}

interface Practice {
  signalwire_number: string | null
  twilio_phone_number: string | null
}

const STEPS = [
  { id: 'calendar',   title: 'Connect your calendar',   subtitle: 'So Ellie can read your free/busy and book on it.' },
  { id: 'greeting',   title: 'Customize your greeting', subtitle: 'Make Ellie sound like your practice.' },
  { id: 'phone',      title: 'Claim a phone number',    subtitle: 'Pick an area code, search availability.' },
  { id: 'test_call',  title: 'Make a test call',        subtitle: 'Verify the receptionist captures intake correctly.' },
] as const
type StepId = typeof STEPS[number]['id']

function isDone(state: State | null, id: StepId): boolean {
  if (!state) return false
  return !!(state as any)[`step_${id}_done`]
}

export default function ReceptionOnboardingPage() {
  const [state, setState] = useState<State | null>(null)
  const [practice, setPractice] = useState<Practice | null>(null)
  const [active, setActive] = useState<StepId>('calendar')

  async function load() {
    const [oRes, pRes] = await Promise.all([
      fetch('/api/reception/onboarding'),
      fetch('/api/practice/me'),
    ])
    if (oRes.ok) {
      const oj = await oRes.json()
      setState(oj.state)
    }
    if (pRes.ok) {
      const pj = await pRes.json()
      setPractice(pj.practice ?? null)
    }
  }
  useEffect(() => { void load() }, [])

  // Auto-advance to first incomplete step on mount
  useEffect(() => {
    if (!state) return
    const next = STEPS.find(s => !isDone(state, s.id))
    if (next) setActive(next.id)
  }, [state])

  async function markDone(id: StepId) {
    const r = await fetch('/api/reception/onboarding', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ step: id }),
    })
    const j = await r.json()
    if (r.ok) setState(j.state)
  }

  return (
    <div className="max-w-3xl mx-auto p-6">
      <h1 className="text-2xl font-semibold text-gray-900">Get your AI receptionist live</h1>
      <p className="text-sm text-gray-500 mt-1">Four quick steps. About 15 minutes total.</p>

      <ol className="mt-6 space-y-2">
        {STEPS.map((step, i) => {
          const done = isDone(state, step.id)
          const open = active === step.id
          return (
            <li key={step.id} className={`border rounded-xl ${open ? 'border-blue-300 bg-blue-50/30' : 'border-gray-200 bg-white'}`}>
              <button onClick={() => setActive(step.id)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left">
                <span className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold border ${done ? 'bg-emerald-600 border-emerald-600 text-white' : 'border-gray-300 text-gray-500'}`}>
                  {done ? '✓' : i + 1}
                </span>
                <div className="flex-1">
                  <div className="text-sm font-semibold text-gray-900">{step.title}</div>
                  <div className="text-xs text-gray-500">{step.subtitle}</div>
                </div>
              </button>

              {open && (
                <div className="border-t border-gray-200 px-4 py-4 space-y-3">
                  {step.id === 'calendar' && (
                    <>
                      <p className="text-sm text-gray-700">
                        Connect your existing calendar so the receptionist can see your availability and write events back.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <a href="/api/integrations/google-calendar/auth" className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-3 py-2 rounded-md">Connect Google</a>
                        <a href="/api/integrations/outlook/auth" className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-3 py-2 rounded-md">Connect Outlook</a>
                        <button onClick={() => markDone('calendar')} className="text-sm text-gray-600 hover:text-gray-900">I've connected — mark done</button>
                      </div>
                    </>
                  )}
                  {step.id === 'greeting' && (
                    <>
                      <p className="text-sm text-gray-700">
                        Customize what Ellie says when calls come in. Pick a voice and edit the greeting.
                      </p>
                      <div className="flex gap-2">
                        <Link href="/dashboard/settings/voice" className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-3 py-2 rounded-md">Open voice settings</Link>
                        <button onClick={() => markDone('greeting')} className="text-sm text-gray-600 hover:text-gray-900">Skip / mark done</button>
                      </div>
                    </>
                  )}
                  {step.id === 'phone' && (
                    <>
                      <p className="text-sm text-gray-700">
                        Pick the phone number patients will dial. We forward it to Ellie automatically.
                      </p>
                      <div className="flex gap-2">
                        <Link href="/dashboard/settings/phone" className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-3 py-2 rounded-md">Choose a number</Link>
                        <button onClick={() => markDone('phone')} className="text-sm text-gray-600 hover:text-gray-900">Skip / mark done</button>
                      </div>
                    </>
                  )}
                  {step.id === 'test_call' && (
                    <>
                      <p className="text-sm text-gray-700">
                        Call your new number from your cell phone. Pretend you're a new patient — say your name, give a fake DOB, mention your insurance. Then check the captured info on the Calls dashboard.
                      </p>
                      {(() => {
                        const num = practice?.signalwire_number || practice?.twilio_phone_number
                        if (num) {
                          return (
                            <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm">
                              <span className="text-gray-700">Your number: </span>
                              <a href={`tel:${num}`} className="font-mono text-blue-700 hover:underline">{num}</a>
                              <span className="text-gray-500 text-xs ml-2">(tap to call on mobile)</span>
                            </div>
                          )
                        }
                        return (
                          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                            No phone number claimed yet — finish step 3 first.
                          </div>
                        )
                      })()}
                      <div className="flex gap-2">
                        <Link href="/dashboard/receptionist/calls" className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-3 py-2 rounded-md">Open Calls dashboard</Link>
                        <button onClick={() => markDone('test_call')} className="text-sm text-gray-600 hover:text-gray-900">I called — mark done</button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ol>

      {state?.is_live && (
        <div className="mt-6 bg-emerald-50 border border-emerald-300 rounded-xl p-5">
          <div className="text-emerald-900 font-semibold">You're live.</div>
          <div className="text-sm text-emerald-800 mt-1">
            Ellie is answering calls now. <Link href="/dashboard/receptionist/calls" className="underline">Open the Calls dashboard →</Link>
          </div>
        </div>
      )}
    </div>
  )
}
