import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Harbor EHR — full clinical workflow for therapy practices',
  description:
    'Harbor EHR is the complete clinical front office for therapy practices: scheduling, charting, billing, voice-to-text notes, no-show prediction, claim resubmits, and an AI receptionist included.',
}

const APP_URL = 'https://lab.harboroffice.ai'

export default function EHRPage() {
  return (
    <>
      <section className="text-white px-6 py-24" style={{ background: 'linear-gradient(135deg, #1f375d 0%, #3e85af 100%)' }}>
        <div className="max-w-5xl mx-auto">
          <p className="text-sm font-semibold uppercase tracking-wider mb-4 text-white/70">Harbor EHR</p>
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight leading-[1.05] mb-6">
            The complete clinical front office for therapy practices.
          </h1>
          <p className="text-lg md:text-xl text-white/85 max-w-2xl leading-relaxed mb-8">
            Charting, scheduling, billing, intake, secure messaging, and Ellie the AI receptionist —
            in one HIPAA-aligned system that runs on AWS and signs a BAA on day one.
          </p>
          <div className="flex flex-col sm:flex-row gap-3">
            <Link href="/contact" className="bg-white font-semibold px-7 py-3.5 rounded-xl text-lg hover:shadow-xl transition-all" style={{ color: '#1f375d' }}>
              Book a Demo
            </Link>
            <Link href="/pricing" className="border-2 border-white/40 text-white px-7 py-3.5 rounded-xl font-semibold text-lg hover:bg-white/10 transition-all">
              See pricing
            </Link>
          </div>
        </div>
      </section>

      {/* Module list */}
      <section className="px-6 py-24 bg-white">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight" style={{ color: '#1f375d' }}>
              Everything your practice runs on, in one place.
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {[
              {
                title: 'Charting & SOAP notes',
                desc: 'Templated notes for therapy, plus AI-drafted SOAP notes from session audio. Edit, sign, and lock.',
              },
              {
                title: 'Voice-to-text dictation',
                desc: 'Stop typing notes after sessions. Drop the audio, get a structured draft in under a minute.',
              },
              {
                title: 'Scheduling & calendar',
                desc: 'Two-way Google Calendar sync, recurring appointments, group sessions, and waitlist auto-fill.',
              },
              {
                title: 'No-show prediction',
                desc: 'Each appointment gets a no-show risk score. High-risk slots trigger reminders and waitlist outreach automatically.',
              },
              {
                title: 'Insurance & billing',
                desc: 'Claim submission, ERA reconciliation, and automated resubmits on denial through your billing partner.',
              },
              {
                title: 'AI receptionist included',
                desc: 'Ellie answers every call 24/7, screens new patients, books on your calendar, and pushes summaries into the chart.',
              },
              {
                title: 'Patient portal & intake',
                desc: 'Branded portal for patients to complete intake, sign consents, message securely, and view appointments.',
              },
              {
                title: 'Secure messaging',
                desc: 'HIPAA-aligned SMS and in-app messaging. Bulk messaging, templates, automated reminders, opt-out handling.',
              },
              {
                title: 'Crisis detection',
                desc: '3-tier real-time crisis detection across calls and messages. 988 escalation built in, urgent SMS to the on-call therapist.',
              },
            ].map(({ title, desc }) => (
              <div key={title} className="rounded-2xl p-6 border border-gray-200 hover:border-gray-300 hover:shadow-md transition-all bg-white">
                <h3 className="font-semibold mb-2" style={{ color: '#1f375d' }}>{title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Why a purpose-built EHR */}
      <section className="px-6 py-24 bg-gray-50">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-6" style={{ color: '#1f375d' }}>
            Built for therapy. Not adapted from medical software.
          </h2>
          <p className="text-lg text-gray-600 leading-relaxed mb-4">
            Most EHRs were built for primary care or hospital systems and bolted on a behavioral
            health module a decade later. Harbor goes the other way. We built every workflow around
            the realities of solo and small-group therapy practices: longitudinal patient
            relationships, validated screening instruments, telehealth-first delivery, and the
            crisis moments that demand a careful, immediate response.
          </p>
          <p className="text-lg text-gray-600 leading-relaxed">
            That focus is the difference between an EHR that gets in your way and one that
            actually saves you a day a week.
          </p>
        </div>
      </section>

      {/* CTA */}
      <section className="px-6 py-20 text-white text-center" style={{ background: 'linear-gradient(135deg, #1f375d 0%, #3e85af 100%)' }}>
        <div className="max-w-2xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">See the EHR in 15 minutes.</h2>
          <p className="text-white/80 mb-8 text-lg">We&rsquo;ll walk through your workflow and show you exactly how Harbor fits.</p>
          <Link href="/contact" className="inline-block bg-white font-bold px-8 py-4 rounded-xl text-lg hover:shadow-xl transition-all" style={{ color: '#1f375d' }}>
            Book a Demo
          </Link>
        </div>
      </section>
    </>
  )
}
