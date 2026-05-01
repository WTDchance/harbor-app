import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Pricing — Harbor Reception',
  description:
    'Transparent pricing for Harbor Reception. AI receptionist for therapy practices at $249/mo, Group $999/mo, Full Harbor (Reception + EHR) from $349/mo. No per-seat fees.',
}

const TIERS = [
  {
    name: 'Solo Cash-Pay',
    price: '$149',
    period: '/mo',
    desc: 'For solo therapists who don&rsquo;t bill insurance.',
    highlight: false,
    cta: 'Start Solo Cash-Pay',
    features: [
      'Full Harbor EHR (charting, scheduling, billing)',
      'AI receptionist (Ellie) included',
      'Voice-to-text SOAP note drafts',
      'Patient portal &amp; intake forms',
      'Secure SMS &amp; email reminders',
      'Google Calendar two-way sync',
      'BAA on request',
    ],
  },
  {
    name: 'Solo In-Network',
    price: '$299',
    period: '/mo',
    desc: 'For solo therapists who bill insurance.',
    highlight: true,
    cta: 'Start Solo In-Network',
    features: [
      'Everything in Solo Cash-Pay',
      'No-show prediction model',
      'Authorization &amp; visit-limit tracking',
      'Priority support',
    ],
  },
  {
    name: 'Group Practice',
    price: '$899',
    period: '/mo',
    desc: 'Up to 10 clinicians. Add more for $79/seat.',
    highlight: false,
    cta: 'Start Group Practice',
    features: [
      'Everything in Solo In-Network',
      'Up to 10 clinician seats',
      'Practice-wide analytics dashboard',
      'Centralized intake &amp; routing',
      'Group therapy management',
      'Custom assessment library',
      'Audit log exports',
    ],
  },
  {
    name: 'Reception Only',
    price: '$99',
    period: '/mo',
    priceSuffix: '–$129/mo',
    desc: 'AI receptionist standalone. Pairs with your existing EHR.',
    highlight: false,
    cta: 'Start Reception-Only',
    features: [
      'Ellie AI receptionist, 24/7',
      'PHQ-2 / GAD-2 screening on every call',
      '3-tier crisis detection &amp; 988 escalation',
      'Calendar sync (Google / Microsoft 365)',
      'Post-call summaries to email + EHR',
      'Missed-call patient capture',
      'REST API for custom integrations',
    ],
  },
]

const APP_URL = 'https://lab.harboroffice.ai'

export default function PricingPage() {
  return (
    <>
      <section className="text-white px-6 py-20" style={{ background: 'linear-gradient(135deg, #1f375d 0%, #3e85af 100%)' }}>
        <div className="max-w-5xl mx-auto text-center">
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-5">Simple, transparent pricing.</h1>
          <p className="text-lg text-white/85 max-w-2xl mx-auto">
            One flat price per practice. No per-seat fees on solo plans. No hidden add-ons. 30-day
            money-back guarantee on every tier.
          </p>
        </div>
      </section>

      <section className="px-6 py-20 bg-gray-50">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
            {TIERS.map((t) => (
              <div
                key={t.name}
                className={`relative rounded-2xl p-6 lg:p-7 bg-white border ${t.highlight ? 'border-2 shadow-xl' : 'border-gray-200'}`}
                style={t.highlight ? { borderColor: '#52bfc0' } : {}}
              >
                {t.highlight && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-white text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wide whitespace-nowrap"
                        style={{ backgroundColor: '#52bfc0' }}>
                    Most popular
                  </span>
                )}
                <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">{t.name}</h2>
                <div className="mt-2 mb-2">
                  <span className="text-4xl font-bold" style={{ color: '#1f375d' }}>{t.price}</span>
                  <span className="text-gray-500 text-base">{t.period}</span>
                  {t.priceSuffix && <span className="block text-xs text-gray-400 mt-1">{t.priceSuffix}</span>}
                </div>
                <p className="text-sm text-gray-500 mb-6" dangerouslySetInnerHTML={{ __html: t.desc }} />

                <ul className="space-y-2.5 mb-7 text-sm">
                  {t.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-gray-700">
                      <span className="mt-0.5 font-bold flex-shrink-0" style={{ color: '#52bfc0' }}>&#10003;</span>
                      <span dangerouslySetInnerHTML={{ __html: f }} />
                    </li>
                  ))}
                </ul>

                <a
                  href={`${APP_URL}/signup`}
                  className={`block text-center w-full py-3 rounded-lg font-semibold text-sm transition-all ${
                    t.highlight ? 'text-white hover:shadow-lg' : 'border-2'
                  }`}
                  style={
                    t.highlight
                      ? { backgroundColor: '#1f375d' }
                      : { borderColor: '#1f375d', color: '#1f375d' }
                  }
                >
                  {t.cta}
                </a>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* What's included on every tier */}
      <section className="px-6 py-20 bg-white">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-10">
            <h2 className="text-3xl font-bold tracking-tight mb-3" style={{ color: '#1f375d' }}>
              Included on every plan.
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm text-gray-700">
            {[
              'HIPAA-aligned AWS infrastructure',
              'KMS-encrypted PHI at rest, TLS in transit',
              'Signed Business Associate Agreement (BAA)',
              '24/7 AI receptionist (Ellie)',
              '3-tier crisis detection with 988 escalation',
              'Google Calendar two-way sync',
              'Audit logging for every PHI access',
              '30-day money-back guarantee',
            ].map((f) => (
              <div key={f} className="flex items-start gap-2">
                <span className="mt-0.5 font-bold" style={{ color: '#52bfc0' }}>&#10003;</span>
                <span>{f}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="px-6 py-20 text-white text-center" style={{ background: 'linear-gradient(135deg, #1f375d 0%, #3e85af 100%)' }}>
        <div className="max-w-2xl mx-auto">
          <h2 className="text-3xl font-bold mb-4">Not sure which tier fits?</h2>
          <p className="text-white/80 mb-8 text-lg">A 15-minute call is the fastest way to find the right plan.</p>
          <Link href="/contact" className="inline-block bg-white font-bold px-8 py-4 rounded-xl text-lg hover:shadow-xl transition-all" style={{ color: '#1f375d' }}>
            Book a Demo
          </Link>
        </div>
      </section>
    </>
  )
}
