'use client'

// app/roi/page.tsx
// Harbor — Public ROI calculator.
// Therapists enter their numbers, see their annual revenue + time loss, and are
// prompted to send themselves the report (which also captures the lead).
// Live calculation updates as they type — every submission gets stored server-side
// via /api/roi/submit and fires a notification to sales.

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'

const fmtUSD = (cents: number) =>
  `$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`

const HARBOR_ANNUAL_COST_CENTS = 397 * 12 * 100 // $4,764/year at $397/mo

export default function RoiCalculatorPage() {
  // --- Inputs ---
  const [sessionRate, setSessionRate] = useState<number>(175)
  const [missedCallsPerWeek, setMissedCallsPerWeek] = useState<number>(5)
  const [missedAppointmentsPerWeek, setMissedAppointmentsPerWeek] = useState<number>(2)
  const [insuranceHoursPerWeek, setInsuranceHoursPerWeek] = useState<number>(3)
  const [weeksPerYear, setWeeksPerYear] = useState<number>(48)
  const [conversionPct, setConversionPct] = useState<number>(30)

  // --- Lead capture ---
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [practiceName, setPracticeName] = useState('')
  const [phone, setPhone] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // UTM capture on mount
  const [utm, setUtm] = useState<Record<string, string>>({})
  const [referrer, setReferrer] = useState('')
  useEffect(() => {
    try {
      const p = new URLSearchParams(window.location.search)
      const cap: Record<string, string> = {}
      for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']) {
        const v = p.get(k)
        if (v) cap[k] = v
      }
      setUtm(cap)
      setReferrer(document.referrer || '')
    } catch {}
  }, [])

  // --- Live calculation (mirrors server logic so the number they see
  //     matches what gets stored) ---
  const calc = useMemo(() => {
    const sessionRateCents = Math.round(sessionRate * 100)
    const missedPatientsPerYear =
      missedCallsPerWeek * (conversionPct / 100) * weeksPerYear
    const revenueLossFromCalls = Math.round(missedPatientsPerYear * sessionRateCents)
    const revenueLossFromNoshows =
      missedAppointmentsPerWeek * weeksPerYear * sessionRateCents
    const timeLoss = Math.round(insuranceHoursPerWeek * weeksPerYear * sessionRateCents)
    const totalAnnual = revenueLossFromCalls + revenueLossFromNoshows + timeLoss
    const harborCost = HARBOR_ANNUAL_COST_CENTS
    const netAnnualBenefit = totalAnnual - harborCost
    const roiMultiple = harborCost > 0 ? totalAnnual / harborCost : 0
    return {
      revenueLossFromCalls,
      revenueLossFromNoshows,
      timeLoss,
      totalAnnual,
      harborCost,
      netAnnualBenefit,
      roiMultiple,
    }
  }, [
    sessionRate,
    missedCallsPerWeek,
    missedAppointmentsPerWeek,
    insuranceHoursPerWeek,
    weeksPerYear,
    conversionPct,
  ])

  async function handleSubmit() {
    setSubmitError(null)
    setSubmitting(true)
    try {
      const res = await fetch('/api/roi/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email || undefined,
          first_name: firstName || undefined,
          last_name: lastName || undefined,
          practice_name: practiceName || undefined,
          phone: phone || undefined,
          session_rate: sessionRate,
          missed_calls_per_week: missedCallsPerWeek,
          missed_appointments_per_week: missedAppointmentsPerWeek,
          insurance_hours_per_week: insuranceHoursPerWeek,
          weeks_worked_per_year: weeksPerYear,
          conversion_rate_pct: conversionPct,
          ...utm,
          referrer_url: referrer || undefined,
        }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        setSubmitError(json.error || 'Something went wrong. Please try again.')
        return
      }
      setSubmitted(true)
    } catch (e: any) {
      setSubmitError(e?.message || 'Network error.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 py-10">
        {/* Header */}
        <div className="mb-8">
          <Link href="/" className="text-teal-700 hover:text-teal-900 text-sm">&larr; Back to Harbor</Link>
          <h1 className="text-3xl md:text-4xl font-bold text-gray-900 mt-4">
            What are missed calls costing your practice?
          </h1>
          <p className="text-gray-600 mt-3 max-w-2xl">
            Fill in a few numbers about your practice and we&apos;ll show you exactly how much
            revenue is walking out the door every year. Honest math, no sales pressure.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {/* Inputs */}
          <div className="bg-white border border-gray-200 rounded-xl p-6">
            <h2 className="font-semibold text-gray-900 mb-4">Your practice</h2>
            <div className="space-y-5">
              <Field label="Average session rate ($)" hint="Your typical fee for a 50-min session.">
                <input
                  type="number"
                  value={sessionRate}
                  onChange={e => setSessionRate(Number(e.target.value) || 0)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </Field>

              <Field label="Missed calls per week" hint="Calls that went to voicemail or rang out. If you don&apos;t know, most solo therapists report 3–8.">
                <input
                  type="number"
                  value={missedCallsPerWeek}
                  onChange={e => setMissedCallsPerWeek(Number(e.target.value) || 0)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </Field>

              <Field label="Missed appointments per week" hint="No-shows, late cancels, unfilled reschedules.">
                <input
                  type="number"
                  value={missedAppointmentsPerWeek}
                  onChange={e => setMissedAppointmentsPerWeek(Number(e.target.value) || 0)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </Field>

              <Field label="Hours/week on insurance verification" hint="Calling payers, checking benefits, chasing authorizations.">
                <input
                  type="number"
                  step="0.5"
                  value={insuranceHoursPerWeek}
                  onChange={e => setInsuranceHoursPerWeek(Number(e.target.value) || 0)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </Field>

              <details className="text-sm">
                <summary className="text-gray-500 cursor-pointer select-none">Advanced assumptions</summary>
                <div className="mt-4 space-y-4 pt-4 border-t border-gray-100">
                  <Field label="Weeks worked per year" hint="48 accounts for holidays and a couple weeks off.">
                    <input
                      type="number"
                      value={weeksPerYear}
                      onChange={e => setWeeksPerYear(Number(e.target.value) || 0)}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                    />
                  </Field>
                  <Field label="% of missed callers who would book if reached" hint="Solo therapists typically see 25-40% conversion on reached inquiries.">
                    <input
                      type="number"
                      value={conversionPct}
                      onChange={e => setConversionPct(Number(e.target.value) || 0)}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                    />
                  </Field>
                </div>
              </details>
            </div>
          </div>

          {/* Results */}
          <div className="bg-white border border-gray-200 rounded-xl p-6">
            <h2 className="font-semibold text-gray-900 mb-4">Your annual loss</h2>

            <div className="space-y-3 text-sm">
              <Row label="Missed-call revenue" value={fmtUSD(calc.revenueLossFromCalls)} />
              <Row label="Missed-appointment revenue" value={fmtUSD(calc.revenueLossFromNoshows)} />
              <Row label="Insurance-verification time" value={fmtUSD(calc.timeLoss)} />
              <div className="h-px bg-gray-200 my-3" />
              <div className="flex items-baseline justify-between">
                <span className="text-gray-700 font-medium">Total annual loss</span>
                <span className="text-3xl font-bold text-red-600">{fmtUSD(calc.totalAnnual)}</span>
              </div>
            </div>

            <div className="mt-6 pt-6 border-t border-gray-100">
              <p className="text-xs text-gray-500 mb-2">Harbor at $397/mo costs {fmtUSD(calc.harborCost)}/year.</p>
              {calc.netAnnualBenefit > 0 ? (
                <>
                  <p className="text-lg text-gray-900">
                    Net benefit of Harbor: <strong className="text-teal-700">{fmtUSD(calc.netAnnualBenefit)}/year</strong>
                  </p>
                  <p className="text-sm text-gray-500 mt-1">
                    That&apos;s a <strong>{calc.roiMultiple.toFixed(1)}×</strong> return on your subscription.
                  </p>
                </>
              ) : (
                <p className="text-sm text-gray-500">
                  If these numbers are accurate, Harbor saves you time and peace of mind even if the dollar math is close to break-even. Many solo therapists underestimate missed calls by 2-3×.
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Lead capture */}
        <div className="mt-8 bg-teal-50 border border-teal-200 rounded-xl p-6">
          {submitted ? (
            <div className="text-center py-6">
              <h3 className="text-xl font-semibold text-gray-900 mb-2">Got it — thanks!</h3>
              <p className="text-gray-700">
                We saved your numbers and Chance, our founder, will reach out within one business day.
                In the meantime, check out <Link href="/" className="text-teal-700 underline">how Harbor works</Link>.
              </p>
            </div>
          ) : (
            <>
              <h3 className="font-semibold text-gray-900 mb-2">Want a copy of this sent to you?</h3>
              <p className="text-sm text-gray-600 mb-4">
                Drop your info and our founder will email you this report plus a 15-min walkthrough offer. No auto-emails, no newsletters. Just a real human reading your numbers.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <input
                  type="text"
                  placeholder="First name"
                  value={firstName}
                  onChange={e => setFirstName(e.target.value)}
                  className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
                <input
                  type="text"
                  placeholder="Last name"
                  value={lastName}
                  onChange={e => setLastName(e.target.value)}
                  className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
                <input
                  type="text"
                  placeholder="Practice name (optional)"
                  value={practiceName}
                  onChange={e => setPracticeName(e.target.value)}
                  className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 md:col-span-2"
                />
                <input
                  type="email"
                  placeholder="Email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
                <input
                  type="tel"
                  placeholder="Phone (optional)"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>
              {submitError && (
                <p className="text-sm text-red-600 mt-3">{submitError}</p>
              )}
              <div className="mt-4 flex items-center gap-3">
                <button
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="px-5 py-2.5 bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium rounded-lg disabled:opacity-60 transition-colors"
                >
                  {submitting ? 'Sending...' : 'Send me my report'}
                </button>
                <span className="text-xs text-gray-500">
                  We don&apos;t share your data. See our <Link href="/privacy-policy" className="underline">privacy policy</Link>.
                </span>
              </div>
            </>
          )}
        </div>

        <p className="mt-10 text-xs text-gray-400 text-center">
          Harbor — AI front office for therapy practices. Real therapist-focused pricing, no contracts, cancel anytime.
        </p>
      </div>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-gray-700 mb-1">{label}</span>
      {children}
      {hint && <span className="block text-xs text-gray-500 mt-1">{hint}</span>}
    </label>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-gray-600">{label}</span>
      <span className="font-medium text-gray-900">{value}</span>
    </div>
  )
}
