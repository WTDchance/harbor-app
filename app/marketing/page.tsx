import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Harbor — AI Receptionist for Therapy Practices',
  description:
    'AI receptionist that answers calls 24/7, captures intake, verifies insurance in real time, and books appointments. Plugs into any EHR — Athena, Ensora, SimplePractice, TheraNest, or your existing calendar. HIPAA-aligned on AWS.',
}

const APP_URL = 'https://lab.harboroffice.ai'

export default function MarketingHome() {
  return (
    <>
      {/* Hero */}
      <section
        className="relative overflow-hidden text-white px-6 py-24 lg:py-32"
        style={{ background: 'linear-gradient(135deg, #1f375d 0%, #3e85af 50%, #52bfc0 100%)' }}
      >
        <div className="absolute top-0 right-0 w-96 h-96 rounded-full opacity-10 -translate-y-1/2 translate-x-1/3"
             style={{ background: 'radial-gradient(circle, #52bfc0, transparent)' }} />
        <div className="absolute bottom-0 left-0 w-80 h-80 rounded-full opacity-10 translate-y-1/3 -translate-x-1/4"
             style={{ background: 'radial-gradient(circle, #3e85af, transparent)' }} />

        <div className="max-w-6xl mx-auto relative z-10">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
            <div className="lg:col-span-7">
              <div className="inline-flex items-center gap-2 bg-white/15 backdrop-blur-sm text-white/90 text-sm px-4 py-1.5 rounded-full mb-6 border border-white/20">
                <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></span>
                AI Receptionist for Therapy · HIPAA-aligned on AWS
              </div>
              <h1 className="text-4xl lg:text-6xl font-bold mb-6 leading-[1.05] tracking-tight">
                The AI receptionist<br />therapy practices deserve.
              </h1>
              <p className="text-lg text-white/85 mb-8 max-w-2xl leading-relaxed">
                Ellie answers every call, captures intake, verifies insurance in real time, books on your
                calendar, and pushes call summaries to your existing EHR. Plugs into Athena, Ensora,
                SimplePractice, TheraNest, or any Google/Microsoft 365 calendar.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <Link
                  href="/contact"
                  className="bg-white font-semibold px-7 py-3.5 rounded-xl text-lg hover:shadow-xl hover:scale-[1.02] transition-all text-center"
                  style={{ color: '#1f375d' }}
                >
                  Book a Demo &rarr;
                </Link>
                <Link
                  href="/reception"
                  className="border-2 border-white/40 text-white px-7 py-3.5 rounded-xl font-semibold text-lg hover:bg-white/10 transition-all text-center"
                >
                  See how it works
                </Link>
              </div>
              <p className="text-white/60 mt-6 text-sm">
                Reception $249/mo · Reception Group $999/mo
              </p>
            </div>

            <div className="lg:col-span-5 hidden lg:block">
              <div className="bg-white rounded-2xl shadow-2xl overflow-hidden border border-white/20 transform rotate-1 hover:rotate-0 transition-transform duration-500">
                <div className="bg-gray-50 px-4 py-2 flex items-center gap-2 border-b border-gray-100">
                  <div className="w-3 h-3 rounded-full bg-red-400"></div>
                  <div className="w-3 h-3 rounded-full bg-yellow-400"></div>
                  <div className="w-3 h-3 rounded-full bg-green-400"></div>
                  <span className="text-xs text-gray-400 ml-2">harboroffice.ai/dashboard</span>
                </div>
                <div className="p-6 space-y-4">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <div className="text-xs text-gray-400 uppercase tracking-wide">This week</div>
                      <div className="text-sm font-semibold" style={{ color: '#1f375d' }}>Practice overview</div>
                    </div>
                    <span className="text-xs px-2 py-1 rounded-full" style={{ backgroundColor: '#e8f8f8', color: '#1f375d' }}>
                      All systems live
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-gray-50 rounded-lg p-3 text-center">
                      <div className="text-2xl font-bold" style={{ color: '#52bfc0' }}>32</div>
                      <div className="text-xs text-gray-500">Calls answered</div>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-3 text-center">
                      <div className="text-2xl font-bold" style={{ color: '#3e85af' }}>9</div>
                      <div className="text-xs text-gray-500">New patients</div>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-3 text-center">
                      <div className="text-2xl font-bold" style={{ color: '#1f375d' }}>0</div>
                      <div className="text-xs text-gray-500">Missed calls</div>
                    </div>
                  </div>
                  <div className="border border-gray-100 rounded-lg p-3 bg-gradient-to-br from-teal-50/50 to-white">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="w-5 h-5 rounded-full bg-green-100 flex items-center justify-center">
                        <span className="text-green-600 text-xs">&#10003;</span>
                      </div>
                      <span className="text-sm font-medium" style={{ color: '#1f375d' }}>Note draft ready</span>
                    </div>
                    <p className="text-xs text-gray-500 ml-7">SOAP note generated from session audio · ready to review</p>
                  </div>
                  <div className="border border-amber-200 rounded-lg p-3 bg-amber-50/50">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-amber-600 text-xs font-semibold uppercase tracking-wide">No-show risk</span>
                    </div>
                    <p className="text-xs text-gray-600 ml-0">Tomorrow 2:00 PM &middot; J. Reyes &middot; suggested: send reminder</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Trust strip */}
      <section className="border-b border-gray-100 px-6 py-8 bg-white">
        <div className="max-w-5xl mx-auto">
          <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-3 text-xs uppercase tracking-wider text-gray-400">
            <span>HIPAA-aligned · AWS</span>
            <span aria-hidden>&middot;</span>
            <span>BAA on request</span>
            <span aria-hidden>&middot;</span>
            <span>Built with practicing therapists</span>
          </div>
        </div>
      </section>

      {/* Two-product overview */}
      <section className="px-6 py-24 bg-white">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <p className="text-sm font-semibold uppercase tracking-wider mb-3" style={{ color: '#52bfc0' }}>
              How Harbor fits your practice
            </p>
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight" style={{ color: '#1f375d' }}>
              Reception standalone — or with the EHR underneath.
            </h2>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Harbor EHR */}
            <div className="rounded-3xl border-2 p-8 lg:p-10 hover:shadow-xl transition-shadow"
                 style={{ borderColor: '#52bfc0', background: 'linear-gradient(180deg, #ffffff 0%, #f5fcfc 100%)' }}>
              <div className="flex items-center gap-2 mb-4">
                <span className="text-xs font-bold uppercase tracking-wider px-3 py-1 rounded-full text-white"
                      style={{ backgroundColor: '#52bfc0' }}>
                  Full suite
                </span>
              </div>
              <h3 className="text-2xl font-bold mb-3" style={{ color: '#1f375d' }}>Harbor EHR</h3>
              <p className="text-gray-600 mb-6">
                The complete clinical workflow. Charting, scheduling, billing, secure messaging,
                voice-to-text notes, no-show prediction, claim resubmit automation — and Ellie,
                the AI receptionist, built in.
              </p>
              <ul className="space-y-2.5 mb-8 text-sm text-gray-700">
                {[
                  'AI-drafted SOAP notes from session audio',
                  'No-show prediction & smart waitlist filling',
                  'Ellie AI receptionist included',
                  'Patient portal, intake, and secure messaging',
                ].map((f) => (
                  <li key={f} className="flex items-start gap-2.5">
                    <span className="mt-0.5 font-bold" style={{ color: '#52bfc0' }}>&#10003;</span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <Link
                href="/ehr"
                className="inline-flex items-center gap-2 font-semibold text-sm group"
                style={{ color: '#1f375d' }}
              >
                Explore Harbor EHR
                <span className="transition-transform group-hover:translate-x-1">&rarr;</span>
              </Link>
            </div>

            {/* Harbor Reception */}
            <div className="rounded-3xl border-2 border-gray-200 p-8 lg:p-10 hover:shadow-xl transition-shadow bg-white">
              <div className="flex items-center gap-2 mb-4">
                <span className="text-xs font-bold uppercase tracking-wider px-3 py-1 rounded-full"
                      style={{ backgroundColor: '#1f375d', color: 'white' }}>
                  Standalone
                </span>
              </div>
              <h3 className="text-2xl font-bold mb-3" style={{ color: '#1f375d' }}>Harbor Reception</h3>
              <p className="text-gray-600 mb-6">
                Already on another EHR? Run just our AI receptionist. Ellie answers every call,
                screens new patients, books on your calendar, and pushes call summaries into
                your existing system.
              </p>
              <ul className="space-y-2.5 mb-8 text-sm text-gray-700">
                {[
                  'Warm AI receptionist live 24/7',
                  '3-tier crisis detection with 988 escalation',
                  'PHQ-2/GAD-2 screening on every new-patient call',
                  'Google Calendar &amp; common-EHR webhooks',
                  'Missed-call patient capture',
                ].map((f) => (
                  <li key={f} className="flex items-start gap-2.5">
                    <span className="mt-0.5 font-bold" style={{ color: '#1f375d' }}>&#10003;</span>
                    <span dangerouslySetInnerHTML={{ __html: f }} />
                  </li>
                ))}
              </ul>
              <Link
                href="/reception"
                className="inline-flex items-center gap-2 font-semibold text-sm group"
                style={{ color: '#1f375d' }}
              >
                Explore Harbor Reception
                <span className="transition-transform group-hover:translate-x-1">&rarr;</span>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Differentiators */}
      <section className="px-6 py-24 bg-gray-50">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4" style={{ color: '#1f375d' }}>
              The moat: clinical depth, not generic SaaS.
            </h2>
            <p className="text-gray-500 text-lg max-w-2xl mx-auto">
              Five things you won&rsquo;t find together in any other therapy-practice tool.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {[
              {
                title: 'Voice-to-text notes',
                desc: 'Drop a session recording. Get a HIPAA-grade SOAP note draft in under a minute, ready to review and sign.',
              },
              {
                title: 'No-show prediction',
                desc: 'A model trained on practice data flags high-risk appointments before they happen, and suggests the right outreach.',
              },
              {
                title: 'EHR-agnostic calendar sync',
                desc: 'Connects to Google Calendar or Outlook so the receptionist reads your free/busy and books on whichever calendar you already use. Plays nice with any EHR.',
              },
              {
                title: 'Missed-call patient capture',
                desc: 'Every missed call gets an immediate AI callback or text. New patients book themselves. You never lose them again.',
              },
              {
                title: 'HIPAA-aligned AWS stack',
                desc: 'KMS-encrypted RDS, private subnets, audit logs, BAA-covered services. We can sign a BAA on day one.',
              },
              {
                title: 'PHQ-2 / GAD-2 on every call',
                desc: 'Standardized depression and anxiety screening on every new-patient intake call, with automatic crisis-language detection and 988 escalation.',
              },
            ].map(({ title, desc }) => (
              <div key={title} className="bg-white rounded-2xl p-6 border border-gray-200 hover:border-gray-300 hover:shadow-md transition-all">
                <h3 className="font-semibold mb-2" style={{ color: '#1f375d' }}>{title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Built for therapists */}
      <section className="px-6 py-24 bg-white">
        <div className="max-w-3xl mx-auto text-center">
          <p className="text-sm font-semibold uppercase tracking-wider mb-3" style={{ color: '#52bfc0' }}>
            Built with therapists, for therapists
          </p>
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-6" style={{ color: '#1f375d' }}>
            Not a generic chatbot wrapped in a dashboard.
          </h2>
          <p className="text-lg text-gray-600 leading-relaxed mb-4">
            Every feature in Harbor exists because a real therapist asked for it. Crisis detection
            that escalates the right way. Intake that captures PHQ-2 and GAD-2 on the first call.
            Notes that match how you actually write them. A receptionist with the warmth your
            patients deserve on the worst day of their lives.
          </p>
          <p className="text-base text-gray-500 leading-relaxed">
            We&rsquo;re building the front office our field has been waiting for.
          </p>
        </div>
      </section>

      {/* Pricing teaser */}
      <section className="px-6 py-24 bg-gray-50">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-3" style={{ color: '#1f375d' }}>
              Simple, transparent pricing.
            </h2>
            <p className="text-gray-500 text-lg">No per-seat fees. No surprises.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { tier: 'Reception', price: '$249', sub: '/mo', desc: 'AI receptionist for solo practices. Up to 200 calls/mo.' },
              { tier: 'Reception Group', price: '$999', sub: '/mo', desc: 'Multi-therapist practices. Up to 1,000 calls/mo.' },
              { tier: 'Full Harbor (with EHR)', price: 'From $349', sub: '/mo', desc: 'Reception + complete EHR + billing. For practices ready to consolidate.' },
            ].map(({ tier, price, sub, desc }, i) => (
              <div
                key={tier}
                className={`rounded-2xl p-6 bg-white border ${i === 1 ? 'border-2 shadow-lg relative' : 'border-gray-200'}`}
                style={i === 1 ? { borderColor: '#52bfc0' } : {}}
              >
                {i === 1 && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-white text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wide"
                        style={{ backgroundColor: '#52bfc0' }}>
                    Most popular
                  </span>
                )}
                <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">{tier}</h3>
                <div className="mt-2 mb-3">
                  <span className="text-3xl font-bold" style={{ color: '#1f375d' }}>{price}</span>
                  <span className="text-gray-500 text-sm">{sub}</span>
                </div>
                <p className="text-sm text-gray-500">{desc}</p>
              </div>
            ))}
          </div>

          <div className="text-center mt-10">
            <Link
              href="/pricing"
              className="inline-flex items-center gap-2 font-semibold"
              style={{ color: '#1f375d' }}
            >
              See the full pricing breakdown
              <span>&rarr;</span>
            </Link>
          </div>
        </div>
      </section>

      {/* CTA band */}
      <section className="px-6 py-20 text-white text-center" style={{ background: 'linear-gradient(135deg, #1f375d 0%, #3e85af 100%)' }}>
        <div className="max-w-2xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">Ready to see Harbor in action?</h2>
          <p className="text-white/80 mb-8 text-lg">
            A 15-minute walkthrough is the fastest way to see if Harbor fits your practice.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/contact"
              className="bg-white font-bold px-8 py-4 rounded-xl text-lg hover:shadow-xl hover:scale-[1.02] transition-all"
              style={{ color: '#1f375d' }}
            >
              Book a Demo
            </Link>
            <a
              href={`${APP_URL}/signup`}
              className="border-2 border-white/40 text-white font-bold px-8 py-4 rounded-xl text-lg hover:bg-white/10 transition-all"
            >
              Start Setup
            </a>
          </div>
        </div>
      </section>
    </>
  )
}
