'use client'
// Build marker: 2026-04-21 — post-Railway-trial resume (crisis UI + email)

import Link from 'next/link'
import Image from 'next/image'
import { useEffect, useState, useRef } from 'react'

interface FoundingCount {
  used: number
  cap: number
  remaining: number
  is_founding_available: boolean
  price_cents: number
  regular_price_cents: number
}

export default function LandingPage() {
  const [fc, setFc] = useState<FoundingCount | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch('/api/signup/founding-count', { cache: 'no-store' })
        if (!res.ok) return
        const body = (await res.json()) as FoundingCount
        if (!cancelled) setFc(body)
      } catch {
        // fail silently — hero falls back to static copy
      }
    }
    load()
    const id = setInterval(load, 60000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  const cap = fc?.cap ?? 20
  const remaining = fc?.remaining ?? cap
  const isFoundingAvailable = fc?.is_founding_available ?? true
  const foundingDollars = Math.floor((fc?.price_cents ?? 39700) / 100)
  const regularDollars = Math.floor((fc?.regular_price_cents ?? 59700) / 100)

  const claimed = cap - remaining
  const spotsCopy = remaining <= 0
    ? 'All founding spots claimed'
    : remaining === 1
      ? '1 founding spot left'
      : claimed >= 3
        ? `Only ${remaining} founding spots remaining`
        : 'Limited founding spots available'

  const heroSub = isFoundingAvailable
    ? `$${foundingDollars}/month founding (reg. $${regularDollars}) · ${spotsCopy} · Setup in 5 minutes`
    : `$${regularDollars}/month · Setup in 5 minutes · Founding spots have sold out`

  // ── Missed-call calculator & email capture ──
  const [missedCalls, setMissedCalls] = useState(3)
  const [calcEmail, setCalcEmail] = useState('')
  const [calcSubmitted, setCalcSubmitted] = useState(false)
  const [calcLoading, setCalcLoading] = useState(false)

  const avgNewPatientValue = 2400 // avg annual value of a therapy patient
  const bookingRate = 0.6 // 60% of answered calls book
  const annualLoss = Math.round(missedCalls * 52 * bookingRate * avgNewPatientValue)
  const monthlyLoss = Math.round(annualLoss / 12)

  const handleCalcSubmit = async () => {
    if (!calcEmail.trim() || !/^\S+@\S+\.\S+$/.test(calcEmail)) return
    setCalcLoading(true)
    try {
      await fetch('/api/leads/capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: calcEmail.trim().toLowerCase(),
          source: 'missed_call_calculator',
          missed_calls_per_week: missedCalls,
          estimated_annual_loss: annualLoss,
        }),
      })
      setCalcSubmitted(true)
    } catch { /* fail silently */ }
    setCalcLoading(false)
  }

  // ── Exit-intent popup ──
  const [showExitPopup, setShowExitPopup] = useState(false)
  const [exitEmail, setExitEmail] = useState('')
  const [exitSubmitted, setExitSubmitted] = useState(false)
  const [exitLoading, setExitLoading] = useState(false)
  const exitShownRef = useRef(false)

  useEffect(() => {
    const handleMouseLeave = (e: MouseEvent) => {
      if (e.clientY <= 0 && !exitShownRef.current && !calcSubmitted) {
        exitShownRef.current = true
        setShowExitPopup(true)
      }
    }
    document.addEventListener('mouseleave', handleMouseLeave)
    return () => document.removeEventListener('mouseleave', handleMouseLeave)
  }, [calcSubmitted])

  const handleExitSubmit = async () => {
    if (!exitEmail.trim() || !/^\S+@\S+\.\S+$/.test(exitEmail)) return
    setExitLoading(true)
    try {
      await fetch('/api/leads/capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: exitEmail.trim().toLowerCase(),
          source: 'exit_intent',
        }),
      })
      setExitSubmitted(true)
      setTimeout(() => setShowExitPopup(false), 2000)
    } catch { /* fail silently */ }
    setExitLoading(false)
  }

  const schemaOrg = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        name: 'Harbor Receptionist',
        url: 'https://harborreceptionist.com',
        logo: 'https://harborreceptionist.com/harbor-logo.svg',
        description: 'AI receptionist built for therapy practices. Answers calls 24/7, screens patients, sends summaries.',
        contactPoint: {
          '@type': 'ContactPoint',
          email: 'support@harborreceptionist.com',
          contactType: 'customer service',
        },
      },
      {
        '@type': 'SoftwareApplication',
        name: 'Harbor AI Receptionist',
        applicationCategory: 'HealthApplication',
        operatingSystem: 'Web',
        offers: {
          '@type': 'Offer',
          price: isFoundingAvailable ? foundingDollars : regularDollars,
          priceCurrency: 'USD',
          priceValidUntil: '2027-01-01',
        },
        description: 'AI receptionist for therapy practices. Answers every call, screens new patients, detects crises, and sends full call summaries.',
      },
      {
        '@type': 'FAQPage',
        mainEntity: [
          { '@type': 'Question', name: 'How long does setup take?', acceptedAnswer: { '@type': 'Answer', text: 'Under 5 minutes. Fill out your practice details, and Ellie is live before you finish your coffee.' } },
          { '@type': 'Question', name: 'Will patients know they are talking to an AI?', acceptedAnswer: { '@type': 'Answer', text: 'Yes. Ellie is warm and human-sounding, but she is transparent that she is an AI assistant. Most patients appreciate the quick response.' } },
          { '@type': 'Question', name: 'What happens during a crisis call?', acceptedAnswer: { '@type': 'Answer', text: 'Ellie provides the 988 Suicide and Crisis Lifeline, encourages the caller to seek immediate help, and sends you an urgent SMS alert in real time.' } },
          { '@type': 'Question', name: 'Is this HIPAA compliant?', acceptedAnswer: { '@type': 'Answer', text: 'Yes. Harbor is HIPAA compliant. We encrypt all data in transit and at rest, enforce row-level security for practice isolation, and execute a Business Associate Agreement (BAA) with every practice.' } },
        ],
      },
    ],
  }

  return (
    <div className="min-h-screen bg-white">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(schemaOrg) }}
      />
      {/* Nav — clean with logo */}
      <nav className="bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between sticky top-0 z-50">
        <Link href="/" className="hover:opacity-80 transition-opacity">
          <img src="/harbor-logo.svg" alt="Harbor" className="h-14 w-auto" />
        </Link>
        <div className="flex items-center gap-6">
          <a href="#how-it-works" className="text-sm text-gray-500 hover:text-gray-900 hidden sm:block">How It Works</a>
          <a href="#pricing" className="text-sm text-gray-500 hover:text-gray-900 hidden sm:block">Pricing</a>
          <Link href="/blog" className="text-sm text-gray-500 hover:text-gray-900 hidden sm:block">Blog</Link>
          <Link href="/contact" className="text-sm text-gray-500 hover:text-gray-900 hidden sm:block">Book a Demo</Link>
          <Link href="/login" className="text-sm text-gray-600 hover:text-gray-900">Log in</Link>
          <Link href="/signup" className="text-white px-5 py-2 rounded-lg text-sm font-semibold transition-all hover:shadow-lg" style={{ backgroundColor: '#1f375d' }}>
            Get Started
          </Link>
        </div>
      </nav>

      {/* Hero — navy gradient with visual depth */}
      <section className="relative overflow-hidden text-white px-6 py-20 lg:py-28" style={{ background: 'linear-gradient(135deg, #1f375d 0%, #3e85af 50%, #52bfc0 100%)' }}>
        {/* Decorative circles for depth */}
        <div className="absolute top-0 right-0 w-96 h-96 rounded-full opacity-10 -translate-y-1/2 translate-x-1/3" style={{ background: 'radial-gradient(circle, #52bfc0, transparent)' }} />
        <div className="absolute bottom-0 left-0 w-80 h-80 rounded-full opacity-10 translate-y-1/3 -translate-x-1/4" style={{ background: 'radial-gradient(circle, #3e85af, transparent)' }} />

        <div className="max-w-6xl mx-auto relative z-10">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            {/* Left: Copy */}
            <div className="text-left">
              <div className="inline-flex items-center gap-2 bg-white/15 backdrop-blur-sm text-white/90 text-sm px-4 py-1.5 rounded-full mb-6 border border-white/20">
                <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></span>
                AI receptionist &ndash; live 24/7
              </div>
              <h1 className="text-4xl lg:text-5xl font-bold mb-6 leading-tight">Your practice never<br />misses a call again</h1>
              <p className="text-lg text-white/80 mb-8 max-w-lg">Harbor gives every therapy practice a warm, intelligent AI receptionist who answers calls, screens new patients, and sends you a full summary &ndash; so you can focus on your clients.</p>
              <div className="flex flex-col sm:flex-row gap-3">
                <Link href="/signup" className="bg-white font-semibold px-7 py-3.5 rounded-xl text-lg hover:shadow-xl hover:scale-[1.02] transition-all text-center" style={{ color: '#1f375d' }}>
                  {isFoundingAvailable ? 'Claim a Founding Spot \u2192' : 'Get Started \u2192'}
                </Link>
                <a href="#how-it-works" className="border-2 border-white/40 text-white px-7 py-3.5 rounded-xl font-semibold text-lg hover:bg-white/10 transition-all text-center">See How It Works</a>
              </div>
              <p className="text-white/60 mt-5 text-sm">{heroSub}</p>
            </div>

            {/* Right: Dashboard preview mockup */}
            <div className="hidden lg:block">
              <div className="bg-white rounded-2xl shadow-2xl overflow-hidden border border-gray-200/20 transform rotate-1 hover:rotate-0 transition-transform duration-500">
                <div className="bg-gray-50 px-4 py-2 flex items-center gap-2 border-b border-gray-100">
                  <div className="w-3 h-3 rounded-full bg-red-400"></div>
                  <div className="w-3 h-3 rounded-full bg-yellow-400"></div>
                  <div className="w-3 h-3 rounded-full bg-green-400"></div>
                  <span className="text-xs text-gray-400 ml-2">harborreceptionist.com/dashboard</span>
                </div>
                <div className="p-6 space-y-4">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#52bfc0' }}>
                      <span className="text-white text-xs font-bold">H</span>
                    </div>
                    <div>
                      <div className="text-sm font-semibold" style={{ color: '#1f375d' }}>Good morning, Dr. Trace</div>
                      <div className="text-xs text-gray-400">3 calls handled while you slept</div>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-gray-50 rounded-lg p-3 text-center">
                      <div className="text-2xl font-bold" style={{ color: '#52bfc0' }}>12</div>
                      <div className="text-xs text-gray-500">Calls today</div>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-3 text-center">
                      <div className="text-2xl font-bold" style={{ color: '#3e85af' }}>4</div>
                      <div className="text-xs text-gray-500">New patients</div>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-3 text-center">
                      <div className="text-2xl font-bold" style={{ color: '#1f375d' }}>0</div>
                      <div className="text-xs text-gray-500">Missed calls</div>
                    </div>
                  </div>
                  <div className="border border-gray-100 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-6 h-6 rounded-full bg-green-100 flex items-center justify-center">
                        <span className="text-green-600 text-xs">&#10003;</span>
                      </div>
                      <span className="text-sm font-medium" style={{ color: '#1f375d' }}>New patient intake completed</span>
                    </div>
                    <p className="text-xs text-gray-500 ml-8">Sarah M. &middot; PHQ-2: 3, GAD-2: 2 &middot; Requesting Thursday appt</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Social proof — subtle trust bar */}
      <section className="border-b border-gray-100 px-6 py-6 bg-white">
        <div className="max-w-4xl mx-auto">
          <p className="text-center text-sm text-gray-400 mb-3">Built alongside real therapy practices</p>
          <div className="flex flex-wrap justify-center gap-8">
            <span className="text-gray-400 font-semibold text-sm">Hope &amp; Harmony Counseling</span>
          </div>
        </div>
      </section>

      {/* Problem — use navy for impact */}
      <section className="px-6 py-20 bg-gray-50">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl font-bold mb-4" style={{ color: '#1f375d' }}>Every missed call is a missed patient</h2>
          <p className="text-gray-500 mb-12 text-lg">Therapy practices lose clients before the first session even begins.</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              { stat: '67%', text: "of callers don't leave voicemails when they reach one" },
              { stat: '391%', text: 'higher conversion when you respond in under 1 minute vs. 30+ minutes' },
              { stat: '24/7', text: 'people seek help outside business hours, and you miss them' },
            ].map(({ stat, text }) => (
              <div key={stat} className="bg-white rounded-2xl p-6 border border-gray-200 text-center hover:shadow-md transition-shadow">
                <p className="text-4xl font-bold mb-2" style={{ color: '#52bfc0' }}>{stat}</p>
                <p className="text-gray-600 text-sm">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="px-6 py-20 bg-white">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-4" style={{ color: '#1f375d' }}>Live in minutes. Running forever.</h2>
            <p className="text-gray-500 text-lg">From signup to your first answered call in under 5 minutes.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              { step: '01', title: 'We personalize your AI', desc: 'Tell us your specialties, hours, insurance, and location. We build a custom AI receptionist tuned to your practice.', color: '#1f375d' },
              { step: '02', title: 'Ellie answers every call', desc: 'Warm, calm, and professional \u2013 Ellie greets callers, answers questions, collects intake info, and screens new patients.', color: '#3e85af' },
              { step: '03', title: 'You get a full summary', desc: 'After every call: caller details, AI summary, PHQ-2/GAD-2 scores, appointment request, and full transcript \u2013 all in your dashboard within seconds.', color: '#52bfc0' },
            ].map(({ step, title, desc, color }) => (
              <div key={step} className="relative">
                <div className="text-5xl font-bold mb-4" style={{ color, opacity: 0.2 }}>{step}</div>
                <h3 className="text-lg font-semibold mb-2" style={{ color: '#1f375d' }}>{title}</h3>
                <p className="text-gray-500 text-sm">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features — with brand color accents */}
      <section className="px-6 py-20 bg-gray-50">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-4" style={{ color: '#1f375d' }}>Built for therapy practices, specifically</h2>
            <p className="text-gray-500 text-lg">Not a generic chatbot. A clinical-context AI receptionist.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {[
              { icon: '\uD83D\uDEA8', title: 'Crisis Detection', desc: 'Ellie recognizes warning signs in real time, provides 988 resources, and immediately texts you \u2013 no other platform does this.' },
              { icon: '\uD83E\uDDE0', title: 'Mental Health Screening', desc: 'PHQ-2 and GAD-2 scores captured live on every call. Full PHQ-9 and GAD-7 intake assessments sent automatically.' },
              { icon: '\uD83D\uDCF1', title: 'Smart Waitlist Filling', desc: 'When an appointment cancels, Ellie texts the next patient automatically. They have 10 minutes to claim the slot.' },
              { icon: '\uD83D\uDCCB', title: 'Post-Call Summaries', desc: 'Every call generates a full transcript, AI summary, and action items delivered to your inbox.' },
              { icon: '\uD83D\uDCCA', title: 'Insurance Verification', desc: 'Ellie asks about insurance during intake calls and logs it to your dashboard \u2013 saving you 30\u201345 minutes per new patient.' },
              { icon: '\uD83D\uDD12', title: 'HIPAA Compliant', desc: 'End-to-end encryption, row-level data isolation, and a signed BAA with every practice. Your patient data stays yours.' },
            ].map(({ icon, title, desc }) => (
              <div key={title} className="bg-white rounded-2xl p-5 border border-gray-200 hover:border-gray-300 hover:shadow-md transition-all group">
                <div className="text-3xl mb-3">{icon}</div>
                <h3 className="font-semibold mb-1" style={{ color: '#1f375d' }}>{title}</h3>
                <p className="text-sm text-gray-500">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonial — with brand accent */}
      <section className="px-6 py-20 bg-white">
        <div className="max-w-2xl mx-auto text-center">
          <div className="w-12 h-12 rounded-full mx-auto mb-6 flex items-center justify-center" style={{ backgroundColor: '#52bfc0' }}>
            <span className="text-white text-xl">&ldquo;</span>
          </div>
          <blockquote className="text-xl italic mb-6" style={{ color: '#1f375d' }}>
            &ldquo;As a therapist, I know exactly the problems solo practitioners face &ndash; missed calls, after-hours intake, knowing when to step in during a crisis. Harbor handles all of it with more care and professionalism than I expected. This is the kind of front office our field has been waiting for.&rdquo;
          </blockquote>
          <div className="font-semibold" style={{ color: '#1f375d' }}>Trace Wonser, PhD</div>
          <div className="text-sm text-gray-500">PhD &middot; Private Practice &middot; Harbor Early Advisor</div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-20 px-4" style={{ backgroundColor: '#f8fafc' }}>
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-3xl font-bold mb-3" style={{ color: '#1f375d' }}>Everything included. One price.</h2>
          <p className="text-gray-500 mb-10 text-lg">No tiers. No add-ons. No surprises.</p>

          {isFoundingAvailable ? (
            <div className="bg-orange-50 border border-orange-200 rounded-2xl p-4 mb-8">
              <p className="text-orange-700 font-semibold text-sm">
                \uD83C\uDFAF Founding Practice Offer &ndash; {spotsCopy}
              </p>
              <p className="text-orange-600 text-sm mt-1">
                Lock in ${foundingDollars}/mo forever. Price never increases.
              </p>
            </div>
          ) : (
            <div className="bg-gray-50 border border-gray-200 rounded-2xl p-4 mb-8">
              <p className="text-gray-700 font-semibold text-sm">Founding spots have sold out</p>
              <p className="text-gray-500 text-sm mt-1">Regular pricing of ${regularDollars}/mo is now in effect.</p>
            </div>
          )}

          <div className="rounded-2xl p-10 shadow-lg relative bg-white" style={{ borderWidth: '2px', borderColor: '#52bfc0' }}>
            <div className="absolute -top-4 left-1/2 -translate-x-1/2">
              <span className="text-white text-xs font-bold px-4 py-1.5 rounded-full uppercase tracking-wide" style={{ backgroundColor: '#52bfc0' }}>
                {isFoundingAvailable ? 'Founding Practice' : 'Harbor Standard'}
              </span>
            </div>
            <div className="mt-2 mb-2">
              {isFoundingAvailable ? (
                <>
                  <span className="text-gray-400 line-through text-2xl mr-2">${regularDollars}</span>
                  <span className="text-6xl font-bold" style={{ color: '#1f375d' }}>${foundingDollars}</span>
                  <span className="text-gray-500 text-xl">/month</span>
                </>
              ) : (
                <>
                  <span className="text-6xl font-bold" style={{ color: '#1f375d' }}>${regularDollars}</span>
                  <span className="text-gray-500 text-xl">/month</span>
                </>
              )}
            </div>
            <p className="text-gray-500 mb-8">
              {isFoundingAvailable ? 'Locked in forever for founding practices' : 'Everything you need to run your front desk'}
            </p>
            <ul className="text-left space-y-3 mb-10 max-w-sm mx-auto">
              {[
                'AI receptionist answers every call, 24/7',
                'Appointment booking & calendar sync',
                'Automated SMS reminders',
                'Bulk patient messaging',
                'Intake paperwork automation',
                'Full patient dashboard',
                '30-day money-back guarantee',
              ].map((item) => (
                <li key={item} className="flex items-center gap-3 text-gray-700">
                  <span className="font-bold text-lg" style={{ color: '#52bfc0' }}>{'\u2713'}</span> {item}
                </li>
              ))}
            </ul>
            <a href="/signup" className="block w-full text-center text-white font-bold py-4 rounded-xl text-lg transition-all hover:shadow-lg hover:scale-[1.01]" style={{ backgroundColor: '#1f375d' }}>
              {isFoundingAvailable ? 'Claim Your Founding Practice Spot' : 'Get Started'}
            </a>
            <p className="text-gray-400 text-sm mt-3">
              No contracts. Cancel anytime.
              {isFoundingAvailable && ` Regular price $${regularDollars}/mo after founding spots fill.`}
            </p>
          </div>
        </div>
      </section>

      {/* Cost Comparison */}
      <section className="px-6 py-20 bg-white">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-4" style={{ color: '#1f375d' }}>How Harbor compares</h2>
            <p className="text-gray-500 text-lg">The same coverage as a full-time hire at a fraction of the cost.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                title: 'Part-Time Receptionist',
                price: '$2,500+/mo',
                items: [
                  { label: '24/7 coverage', included: false },
                  { label: 'Crisis detection', included: false },
                  { label: 'Mental health screening', included: false },
                  { label: 'Instant call summaries', included: false },
                  { label: 'Never calls in sick', included: false },
                ],
                highlight: false,
              },
              {
                title: 'Harbor AI',
                price: `$${isFoundingAvailable ? foundingDollars : regularDollars}/mo`,
                items: [
                  { label: '24/7 coverage', included: true },
                  { label: 'Crisis detection', included: true },
                  { label: 'Mental health screening', included: true },
                  { label: 'Instant call summaries', included: true },
                  { label: 'Never calls in sick', included: true },
                ],
                highlight: true,
              },
              {
                title: 'Answering Service',
                price: '$200\u2013500/mo',
                items: [
                  { label: '24/7 coverage', included: true },
                  { label: 'Crisis detection', included: false },
                  { label: 'Mental health screening', included: false },
                  { label: 'Instant call summaries', included: false },
                  { label: 'Never calls in sick', included: true },
                ],
                highlight: false,
              },
            ].map(({ title, price, items, highlight }) => (
              <div
                key={title}
                className={`rounded-2xl p-6 ${highlight ? 'ring-2 shadow-lg bg-white' : 'bg-gray-50 border border-gray-200'}`}
                style={highlight ? { ringColor: '#52bfc0' } : {}}
              >
                <h3 className="font-semibold text-lg mb-1" style={{ color: '#1f375d' }}>{title}</h3>
                <p className="text-2xl font-bold mb-5" style={{ color: highlight ? '#52bfc0' : '#1f375d' }}>{price}</p>
                <ul className="space-y-3">
                  {items.map(({ label, included }) => (
                    <li key={label} className="flex items-center gap-2 text-sm">
                      {included ? (
                        <span className="font-bold" style={{ color: '#52bfc0' }}>{'\u2713'}</span>
                      ) : (
                        <span className="text-red-400 font-bold">{'\u2717'}</span>
                      )}
                      <span className={included ? 'text-gray-700' : 'text-gray-400'}>{label}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Missed Call Calculator */}
      <section className="px-6 py-20" style={{ background: 'linear-gradient(135deg, #1f375d 0%, #3e85af 100%)' }}>
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-3xl font-bold text-white mb-3">What are missed calls costing you?</h2>
          <p className="text-white/70 mb-10">Most therapy practices miss 3–5 calls per week. Here{'\u2019'}s what that means in lost revenue.</p>

          <div className="bg-white/10 backdrop-blur rounded-2xl p-8 border border-white/20">
            <label className="block text-white/80 text-sm mb-3">How many calls do you miss per week?</label>
            <div className="flex items-center justify-center gap-4 mb-6">
              <button
                onClick={() => setMissedCalls(Math.max(1, missedCalls - 1))}
                className="w-10 h-10 rounded-full bg-white/20 text-white text-xl font-bold hover:bg-white/30 transition-colors"
              >&minus;</button>
              <span className="text-5xl font-bold text-white w-16 text-center">{missedCalls}</span>
              <button
                onClick={() => setMissedCalls(Math.min(20, missedCalls + 1))}
                className="w-10 h-10 rounded-full bg-white/20 text-white text-xl font-bold hover:bg-white/30 transition-colors"
              >+</button>
            </div>
            <input
              type="range"
              min={1}
              max={20}
              value={missedCalls}
              onChange={(e) => setMissedCalls(Number(e.target.value))}
              className="w-full mb-8 accent-teal-400"
            />

            <div className="grid grid-cols-2 gap-4 mb-8">
              <div className="bg-white/10 rounded-xl p-4">
                <div className="text-sm text-white/60">Monthly loss</div>
                <div className="text-2xl font-bold text-amber-300">${monthlyLoss.toLocaleString()}</div>
              </div>
              <div className="bg-white/10 rounded-xl p-4">
                <div className="text-sm text-white/60">Annual loss</div>
                <div className="text-2xl font-bold text-amber-300">${annualLoss.toLocaleString()}</div>
              </div>
            </div>

            <p className="text-white/50 text-xs mb-6">Based on 60% booking rate and $2,400 avg. annual patient value.</p>

            {calcSubmitted ? (
              <div className="bg-teal-500/20 border border-teal-400/30 rounded-xl p-4">
                <p className="text-teal-300 font-semibold">{'\u2713'} We{'\u2019'}ll be in touch — check your inbox.</p>
              </div>
            ) : (
              <div>
                <p className="text-white/80 text-sm mb-3">Want to see how Harbor pays for itself? Drop your email.</p>
                <div className="flex gap-2 max-w-md mx-auto">
                  <input
                    type="email"
                    value={calcEmail}
                    onChange={(e) => setCalcEmail(e.target.value)}
                    placeholder="you@yourpractice.com"
                    className="flex-1 px-4 py-3 rounded-lg bg-white/20 border border-white/30 text-white placeholder-white/50 focus:outline-none focus:border-teal-400"
                    onKeyDown={(e) => e.key === 'Enter' && handleCalcSubmit()}
                  />
                  <button
                    onClick={handleCalcSubmit}
                    disabled={calcLoading}
                    className="px-6 py-3 rounded-lg font-semibold text-white transition-all hover:scale-[1.02] disabled:opacity-50"
                    style={{ backgroundColor: '#52bfc0' }}
                  >
                    {calcLoading ? '...' : 'Send'}
                  </button>
                </div>
                <p className="text-white/40 text-xs mt-2">No spam. Just one email with your ROI breakdown.</p>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="px-6 py-20 bg-gray-50">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-10" style={{ color: '#1f375d' }}>Frequently asked questions</h2>
          <div className="space-y-6">
            {[
              { q: 'How long does setup take?', a: 'Under 5 minutes. Fill out your practice details, and Ellie is live before you finish your coffee.' },
              { q: "Will patients know they're talking to an AI?", a: "Yes. Ellie is warm and human-sounding, but she's transparent that she's an AI assistant. Most patients appreciate the quick response." },
              { q: 'What happens during a crisis call?', a: 'Ellie provides the 988 Suicide & Crisis Lifeline, encourages the caller to seek immediate help, and sends you an urgent SMS alert \u2013 all in real time.' },
              { q: 'Can I customize what Ellie says?', a: 'Yes. Your settings dashboard lets you update hours, specialties, location, and more. Every change syncs to Ellie instantly.' },
              { q: 'Is this HIPAA compliant?', a: 'Yes. Harbor is HIPAA compliant. We encrypt all data in transit and at rest, enforce row-level security for practice isolation, and execute a Business Associate Agreement (BAA) with every practice. Learn more on our HIPAA Compliance page.' },
            ].map(({ q, a }) => (
              <div key={q} className="border-b border-gray-100 pb-6">
                <h3 className="font-semibold mb-2" style={{ color: '#1f375d' }}>{q}</h3>
                <p className="text-gray-500 text-sm">{a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Book a Demo */}
      <section id="demo" className="px-6 py-20 bg-gray-50">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-3xl font-bold mb-4" style={{ color: '#1f375d' }}>See Harbor in action</h2>
          <p className="text-gray-500 text-lg mb-8">Book a quick 15-minute walkthrough. We&apos;ll show you exactly how Ellie handles calls, screens patients, and sends you summaries.</p>
          <Link
            href="/contact"
            className="inline-block text-white font-bold px-8 py-4 rounded-xl text-lg hover:shadow-xl hover:scale-[1.02] transition-all"
            style={{ backgroundColor: '#52bfc0' }}
          >
            Book a Demo Call
          </Link>
          <p className="text-gray-400 text-sm mt-4">Or email us at <a href="mailto:hello@harborreceptionist.com" className="underline hover:text-gray-600">hello@harborreceptionist.com</a></p>
        </div>
      </section>

      {/* CTA band */}
      <section className="px-6 py-16 text-white text-center" style={{ background: 'linear-gradient(135deg, #1f375d 0%, #3e85af 100%)' }}>
        <div className="max-w-2xl mx-auto">
          <h2 className="text-3xl font-bold mb-4">Ready to stop missing calls?</h2>
          <p className="text-white/70 mb-8 text-lg">Join the therapy practices that never miss a new patient again.</p>
          <Link href="/signup" className="inline-block bg-white font-bold px-8 py-4 rounded-xl text-lg hover:shadow-xl hover:scale-[1.02] transition-all" style={{ color: '#1f375d' }}>
            {isFoundingAvailable ? 'Claim a Founding Spot \u2192' : 'Get Started \u2192'}
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-100 px-6 py-10 bg-white">
        <div className="max-w-4xl mx-auto">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4 mb-6 pb-6 border-b border-gray-100">
            <div>
              <Link href="/" className="hover:opacity-80 transition-opacity">
                <img src="/harbor-logo.svg" alt="Harbor" className="h-12 w-auto" />
              </Link>
              <p className="text-xs text-gray-400 mt-1">AI receptionist for therapy practices</p>
            </div>
            <div className="flex gap-6 text-sm text-gray-500">
              <Link href="/contact" className="hover:text-gray-900">Book a Demo</Link>
              <Link href="/login" className="hover:text-gray-900">Log in</Link>
              <Link href="/signup" className="hover:text-gray-900">Get Started</Link>
            </div>
          </div>
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-xs text-gray-400">&copy; 2026 Harbor AI. All rights reserved.</p>
            <div className="flex gap-4 text-xs text-gray-500">
              <Link href="/privacy-policy" className="hover:text-gray-900">Privacy Policy</Link>
              <Link href="/sms" className="hover:text-gray-900">SMS Terms</Link>
              <Link href="/terms" className="hover:text-gray-900">Terms of Service</Link>
              <Link href="/hipaa" className="hover:text-gray-900">HIPAA</Link>
            </div>
          </div>
        </div>
      </footer>

      {/* Exit-Intent Popup */}
      {showExitPopup && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm px-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8 relative animate-in fade-in zoom-in">
            <button
              onClick={() => setShowExitPopup(false)}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 text-xl leading-none"
            >&times;</button>

            {exitSubmitted ? (
              <div className="text-center py-4">
                <div className="text-4xl mb-3">{'\u2713'}</div>
                <h3 className="text-xl font-bold mb-2" style={{ color: '#1f375d' }}>You{'\u2019'}re on the list</h3>
                <p className="text-gray-500">We{'\u2019'}ll reach out soon.</p>
              </div>
            ) : (
              <>
                <div className="text-center mb-6">
                  <div className="w-12 h-12 rounded-full mx-auto mb-4 flex items-center justify-center" style={{ backgroundColor: '#52bfc0' }}>
                    <span className="text-white text-xl">{'\uD83D\uDCDE'}</span>
                  </div>
                  <h3 className="text-xl font-bold mb-2" style={{ color: '#1f375d' }}>Before you go&mdash;</h3>
                  <p className="text-gray-500 text-sm">
                    Curious but not ready to commit? Leave your email and we{'\u2019'}ll send you a quick breakdown of how Harbor works for practices like yours.
                  </p>
                </div>
                <div className="space-y-3">
                  <input
                    type="email"
                    value={exitEmail}
                    onChange={(e) => setExitEmail(e.target.value)}
                    placeholder="you@yourpractice.com"
                    className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:outline-none focus:border-teal-500 text-gray-900"
                    onKeyDown={(e) => e.key === 'Enter' && handleExitSubmit()}
                  />
                  <button
                    onClick={handleExitSubmit}
                    disabled={exitLoading}
                    className="w-full py-3 rounded-lg text-white font-semibold transition-all hover:shadow-lg disabled:opacity-50"
                    style={{ backgroundColor: '#1f375d' }}
                  >
                    {exitLoading ? 'Sending...' : 'Send me the details'}
                  </button>
                  <button
                    onClick={() => setShowExitPopup(false)}
                    className="w-full text-sm text-gray-400 hover:text-gray-600"
                  >
                    No thanks, I{'\u2019'}m good
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
