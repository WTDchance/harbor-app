import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Harbor Reception — AI receptionist that plugs into your existing EHR',
  description:
    'Harbor Reception is the standalone AI receptionist for therapy practices already on another EHR. Ellie answers every call, screens new patients, and pushes summaries to your existing system.',
}

const APP_URL = 'https://lab.harboroffice.ai'

export default function ReceptionPage() {
  return (
    <>
      <section className="text-white px-6 py-24" style={{ background: 'linear-gradient(135deg, #1f375d 0%, #3e85af 50%, #52bfc0 100%)' }}>
        <div className="max-w-5xl mx-auto">
          <p className="text-sm font-semibold uppercase tracking-wider mb-4 text-white/80">Harbor Reception</p>
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight leading-[1.05] mb-6">
            The AI receptionist that fits into the EHR you already use.
          </h1>
          <p className="text-lg md:text-xl text-white/85 max-w-2xl leading-relaxed mb-8">
            Already on SimplePractice, TherapyNotes, or another EHR? Keep it. Add Harbor Reception
            for warm, intelligent 24/7 call coverage that pushes summaries straight to your existing
            charts and calendar.
          </p>
          <div className="flex flex-col sm:flex-row gap-3">
            <Link href="/contact" className="bg-white font-semibold px-7 py-3.5 rounded-xl text-lg hover:shadow-xl transition-all" style={{ color: '#1f375d' }}>
              Book a Demo
            </Link>
            <a href={`${APP_URL}/signup`} className="border-2 border-white/40 text-white px-7 py-3.5 rounded-xl font-semibold text-lg hover:bg-white/10 transition-all text-center">
              Start a Reception-Only Trial
            </a>
          </div>
          <p className="text-white/60 mt-6 text-sm">From $99/mo · Setup in under 5 minutes · No EHR migration required</p>
        </div>
      </section>

      {/* What Ellie does */}
      <section className="px-6 py-24 bg-white">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight" style={{ color: '#1f375d' }}>
              What Ellie does on every call.
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {[
              {
                title: 'Answers every call, 24/7',
                desc: 'No more voicemail black holes. Ellie picks up on the first ring, day or night, with the warmth of a real receptionist.',
              },
              {
                title: 'Screens new patients',
                desc: 'PHQ-2 and GAD-2 on the first call. Captures presenting concern, insurance, preferred days, location preference.',
              },
              {
                title: 'Books on your calendar',
                desc: 'Reads availability from Google Calendar (or your EHR&rsquo;s calendar) and books in real-time during the call.',
              },
              {
                title: 'Detects crises in real-time',
                desc: '3-tier detection escalates instantly. 988 referral to the caller, urgent SMS to your on-call phone.',
              },
              {
                title: 'Sends post-call summaries',
                desc: 'Email summary with full transcript, AI summary, screening scores, and action items — within seconds of hangup.',
              },
              {
                title: 'Captures every missed call',
                desc: 'When a caller hangs up before booking, Ellie sends an immediate text with a self-service booking link.',
              },
            ].map(({ title, desc }) => (
              <div key={title} className="rounded-2xl p-6 border border-gray-200 hover:border-gray-300 hover:shadow-md transition-all bg-white">
                <h3 className="font-semibold mb-2" style={{ color: '#1f375d' }}>{title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed" dangerouslySetInnerHTML={{ __html: desc }} />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Integration */}
      <section className="px-6 py-24 bg-gray-50">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4" style={{ color: '#1f375d' }}>
              Plays nicely with your stack.
            </h2>
            <p className="text-gray-500 text-lg max-w-2xl mx-auto">
              Harbor Reception talks to the tools you already use, so you don&rsquo;t change anything else.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {[
              { title: 'Calendar sync', desc: 'Google Calendar, Microsoft 365. Two-way sync so bookings appear instantly.' },
              { title: 'EHR webhooks', desc: 'Push call summaries and intake data into SimplePractice, TherapyNotes, and most modern EHRs.' },
              { title: 'REST API', desc: 'A documented public API for custom integrations. Pull call logs, push contacts, automate workflows.' },
            ].map(({ title, desc }) => (
              <div key={title} className="rounded-2xl bg-white p-6 border border-gray-200">
                <h3 className="font-semibold mb-2" style={{ color: '#1f375d' }}>{title}</h3>
                <p className="text-sm text-gray-500">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Comparison */}
      <section className="px-6 py-24 bg-white">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4" style={{ color: '#1f375d' }}>
              How Harbor Reception compares.
            </h2>
            <p className="text-gray-500 text-lg">The same coverage as a full-time receptionist, at a fraction of the cost.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                title: 'Part-Time Receptionist',
                price: '$2,500+/mo',
                items: [
                  ['24/7 coverage', false],
                  ['Crisis detection', false],
                  ['Mental health screening', false],
                  ['Instant call summaries', false],
                  ['Never calls in sick', false],
                ],
                highlight: false,
              },
              {
                title: 'Harbor Reception',
                price: '$99–129/mo',
                items: [
                  ['24/7 coverage', true],
                  ['Crisis detection', true],
                  ['Mental health screening', true],
                  ['Instant call summaries', true],
                  ['Never calls in sick', true],
                ],
                highlight: true,
              },
              {
                title: 'Answering Service',
                price: '$200–500/mo',
                items: [
                  ['24/7 coverage', true],
                  ['Crisis detection', false],
                  ['Mental health screening', false],
                  ['Instant call summaries', false],
                  ['Never calls in sick', true],
                ],
                highlight: false,
              },
            ].map(({ title, price, items, highlight }) => (
              <div
                key={title}
                className={`rounded-2xl p-6 ${highlight ? 'border-2 shadow-lg bg-white' : 'bg-gray-50 border border-gray-200'}`}
                style={highlight ? { borderColor: '#52bfc0' } : {}}
              >
                <h3 className="font-semibold text-lg mb-1" style={{ color: '#1f375d' }}>{title}</h3>
                <p className="text-2xl font-bold mb-5" style={{ color: highlight ? '#52bfc0' : '#1f375d' }}>{price}</p>
                <ul className="space-y-3">
                  {items.map(([label, included]) => (
                    <li key={label as string} className="flex items-center gap-2 text-sm">
                      {included ? (
                        <span className="font-bold" style={{ color: '#52bfc0' }}>&#10003;</span>
                      ) : (
                        <span className="text-red-400 font-bold">&#10007;</span>
                      )}
                      <span className={included ? 'text-gray-700' : 'text-gray-400'}>{label as string}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="px-6 py-20 text-white text-center" style={{ background: 'linear-gradient(135deg, #1f375d 0%, #3e85af 100%)' }}>
        <div className="max-w-2xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">Hear what Ellie sounds like.</h2>
          <p className="text-white/80 mb-8 text-lg">Book a 15-minute demo and we&rsquo;ll have her call you live.</p>
          <Link href="/contact" className="inline-block bg-white font-bold px-8 py-4 rounded-xl text-lg hover:shadow-xl transition-all" style={{ color: '#1f375d' }}>
            Book a Demo
          </Link>
        </div>
      </section>
    </>
  )
}
