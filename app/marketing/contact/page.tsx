import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Contact Harbor — book a demo',
  description:
    'Talk to Harbor. Book a 15-minute demo, ask about HIPAA, request a BAA, or just say hello.',
}

const APP_URL = 'https://lab.harboroffice.ai'

export default function ContactPage() {
  return (
    <>
      <section className="text-white px-6 py-24" style={{ background: 'linear-gradient(135deg, #1f375d 0%, #3e85af 100%)' }}>
        <div className="max-w-4xl mx-auto">
          <p className="text-sm font-semibold uppercase tracking-wider mb-4 text-white/70">Contact</p>
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight leading-[1.05] mb-6">
            Let&rsquo;s talk.
          </h1>
          <p className="text-lg md:text-xl text-white/85 max-w-2xl leading-relaxed">
            Book a demo, ask a question, or request a BAA. Real humans answer.
          </p>
        </div>
      </section>

      <section className="px-6 py-20 bg-white">
        <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-10">
          {/* Demo */}
          <div className="rounded-2xl border-2 p-8 lg:p-10" style={{ borderColor: '#52bfc0' }}>
            <div className="inline-block text-xs font-bold uppercase tracking-wider px-3 py-1 rounded-full text-white mb-4"
                 style={{ backgroundColor: '#52bfc0' }}>
              Most popular
            </div>
            <h2 className="text-2xl font-bold mb-3" style={{ color: '#1f375d' }}>Book a 15-minute demo</h2>
            <p className="text-gray-600 mb-6 leading-relaxed">
              We&rsquo;ll walk through your practice&rsquo;s workflow, show you Harbor live, and
              answer every question. No pressure, no slides.
            </p>
            <a
              href="mailto:chancewonser@gmail.com?subject=Harbor%20demo%20request&body=Hi%20Chance%2C%0A%0AI%27d%20like%20to%20see%20Harbor.%20My%20practice%20is%3A%0A%0A%20%2D%20Practice%20name%3A%0A%20%2D%20Number%20of%20clinicians%3A%0A%20%2D%20Current%20EHR%20(if%20any)%3A%0A%20%2D%20Best%20day%2Ftime%20for%20a%20call%3A%0A%0AThanks!"
              className="inline-block w-full text-center font-bold px-7 py-3.5 rounded-xl text-base text-white hover:shadow-lg transition-all"
              style={{ backgroundColor: '#1f375d' }}
            >
              Email us to schedule
            </a>
            <p className="text-xs text-gray-400 mt-3 text-center">
              Self-serve scheduling coming soon. Until then, email is fastest.
            </p>
          </div>

          {/* General contact */}
          <div className="rounded-2xl border border-gray-200 p-8 lg:p-10 bg-gray-50">
            <h2 className="text-2xl font-bold mb-3" style={{ color: '#1f375d' }}>Other ways to reach us</h2>
            <p className="text-gray-600 mb-6 leading-relaxed">
              Sales questions, BAA requests, security reviews, support — all go to the same place.
            </p>

            <dl className="space-y-5">
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">Email</dt>
                <dd>
                  <a href="mailto:chancewonser@gmail.com" className="font-semibold text-base" style={{ color: '#1f375d' }}>
                    chancewonser@gmail.com
                  </a>
                </dd>
              </div>

              <div>
                <dt className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">Already a customer?</dt>
                <dd>
                  <a href={`${APP_URL}/login`} className="text-base hover:underline" style={{ color: '#1f375d' }}>
                    Log in to your dashboard &rarr;
                  </a>
                </dd>
              </div>

              <div>
                <dt className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">Ready to start?</dt>
                <dd>
                  <a href={`${APP_URL}/signup`} className="text-base hover:underline" style={{ color: '#1f375d' }}>
                    Create your practice &rarr;
                  </a>
                </dd>
              </div>

              <div>
                <dt className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">Company</dt>
                <dd className="text-sm text-gray-600">
                  Harbor (Delaware C-corp)<br />
                  Klamath Falls, OR
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="px-6 py-20 bg-gray-50">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-3xl font-bold tracking-tight mb-10 text-center" style={{ color: '#1f375d' }}>
            Common questions
          </h2>
          <div className="space-y-6">
            {[
              {
                q: 'How long does setup take?',
                a: 'Under 5 minutes for Reception-only. Under 30 minutes for the full EHR with calendar, intake forms, and SMS configured.',
              },
              {
                q: 'Will you sign a BAA?',
                a: 'Yes. We sign a BAA with every customer before their first patient interaction. We can send our standard template ahead of your demo if it helps with your IT review.',
              },
              {
                q: 'Can I migrate from another EHR?',
                a: 'Yes. We&rsquo;ve written importers for SimplePractice, TherapyNotes, and CSV exports. Tell us what you&rsquo;re coming from and we&rsquo;ll quote a migration path.',
              },
              {
                q: 'Do you offer a free trial?',
                a: 'No free trial, but every plan has a 30-day money-back guarantee. If Harbor isn&rsquo;t a fit in the first month, we refund.',
              },
            ].map(({ q, a }) => (
              <div key={q} className="border-b border-gray-200 pb-5">
                <h3 className="font-semibold mb-2" style={{ color: '#1f375d' }}>{q}</h3>
                <p className="text-sm text-gray-600 leading-relaxed" dangerouslySetInnerHTML={{ __html: a }} />
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  )
}
