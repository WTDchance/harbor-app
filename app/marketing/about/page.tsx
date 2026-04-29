import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'About Harbor',
  description:
    'Harbor is building the AI-powered front office therapy practices deserve. Founded by Chance Wonser, built alongside practicing therapists.',
}

export default function AboutPage() {
  return (
    <>
      <section className="text-white px-6 py-24" style={{ background: 'linear-gradient(135deg, #1f375d 0%, #3e85af 100%)' }}>
        <div className="max-w-4xl mx-auto">
          <p className="text-sm font-semibold uppercase tracking-wider mb-4 text-white/70">About Harbor</p>
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight leading-[1.05] mb-6">
            Therapy is the work. The front office shouldn&rsquo;t be.
          </h1>
          <p className="text-lg md:text-xl text-white/85 max-w-2xl leading-relaxed">
            Harbor exists because solo and small-group therapy practices deserve software that
            works as hard as they do — without the per-seat fees and clunky workflows that have
            defined behavioral health software for the last decade.
          </p>
        </div>
      </section>

      {/* Mission */}
      <section className="px-6 py-20 bg-white">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-6" style={{ color: '#1f375d' }}>
            Our mission.
          </h2>
          <p className="text-lg text-gray-600 leading-relaxed mb-4">
            We&rsquo;re building the AI front office for therapy practices. That means: never miss
            a call, never miss a billable hour to paperwork, never lose a new patient because the
            phone went to voicemail, and never wonder whether a high-risk moment slipped past you.
          </p>
          <p className="text-lg text-gray-600 leading-relaxed">
            Therapists do some of the most important work in the country. They should have the
            best tools.
          </p>
        </div>
      </section>

      {/* Founder */}
      <section className="px-6 py-20 bg-gray-50">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-8" style={{ color: '#1f375d' }}>
            Founder.
          </h2>

          <div className="bg-white rounded-2xl p-8 border border-gray-200">
            <div className="flex items-start gap-5 mb-5">
              <div className="w-16 h-16 rounded-full flex items-center justify-center flex-shrink-0 text-white font-bold text-xl"
                   style={{ backgroundColor: '#1f375d' }}>
                CW
              </div>
              <div>
                <h3 className="text-xl font-semibold" style={{ color: '#1f375d' }}>Chance Wonser</h3>
                <p className="text-sm text-gray-500">Founder &amp; CEO</p>
              </div>
            </div>
            <p className="text-gray-600 leading-relaxed mb-3">
              Chance founded Harbor after watching his mom &mdash; a licensed therapist in solo
              private practice &mdash; lose new patients to missed calls, voicemail, and the
              friction of running a practice alone. He shipped the first version of Harbor with a
              single test customer: her.
            </p>
            <p className="text-gray-600 leading-relaxed">
              Today Harbor is a small, focused team building alongside the practices we serve.
              Every feature ships from real conversations with real therapists.
            </p>
          </div>
        </div>
      </section>

      {/* Story */}
      <section className="px-6 py-20 bg-white">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-6" style={{ color: '#1f375d' }}>
            How we work.
          </h2>
          <ul className="space-y-5 text-gray-600 leading-relaxed">
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-7 h-7 rounded-full text-white font-semibold text-sm flex items-center justify-center mt-0.5"
                    style={{ backgroundColor: '#52bfc0' }}>1</span>
              <div>
                <strong className="text-gray-900">Therapist-led product.</strong> Every roadmap
                decision starts with a real practice telling us what&rsquo;s broken. We don&rsquo;t
                guess.
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-7 h-7 rounded-full text-white font-semibold text-sm flex items-center justify-center mt-0.5"
                    style={{ backgroundColor: '#52bfc0' }}>2</span>
              <div>
                <strong className="text-gray-900">HIPAA from the foundation.</strong> Compliance
                isn&rsquo;t a checkbox we add later. Every architectural choice was made with PHI
                handling in mind.
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-7 h-7 rounded-full text-white font-semibold text-sm flex items-center justify-center mt-0.5"
                    style={{ backgroundColor: '#52bfc0' }}>3</span>
              <div>
                <strong className="text-gray-900">Patient safety is non-negotiable.</strong> Crisis
                detection runs on every call. The system fails safe. Period.
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-7 h-7 rounded-full text-white font-semibold text-sm flex items-center justify-center mt-0.5"
                    style={{ backgroundColor: '#52bfc0' }}>4</span>
              <div>
                <strong className="text-gray-900">Transparent pricing.</strong> One flat price per
                practice. No per-seat traps. No surprise add-ons. 30-day money-back on every plan.
              </div>
            </li>
          </ul>
        </div>
      </section>

      {/* Company */}
      <section className="px-6 py-20 bg-gray-50">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-3xl font-bold tracking-tight mb-5" style={{ color: '#1f375d' }}>
            The company.
          </h2>
          <p className="text-gray-600 leading-relaxed mb-3">
            Harbor is operated by Harbor, a Delaware C corporation founded in 2026. We&rsquo;re
            headquartered in Klamath Falls, Oregon.
          </p>
          <p className="text-gray-600 leading-relaxed">
            Get in touch:{' '}
            <a href="mailto:chancewonser@gmail.com" className="font-semibold" style={{ color: '#1f375d' }}>
              chancewonser@gmail.com
            </a>
          </p>
        </div>
      </section>

      <section className="px-6 py-20 text-white text-center" style={{ background: 'linear-gradient(135deg, #1f375d 0%, #3e85af 100%)' }}>
        <div className="max-w-2xl mx-auto">
          <h2 className="text-3xl font-bold mb-4">Want to talk?</h2>
          <p className="text-white/80 mb-8 text-lg">We love hearing from therapists. Even if you&rsquo;re not buying.</p>
          <Link href="/contact" className="inline-block bg-white font-bold px-8 py-4 rounded-xl text-lg hover:shadow-xl transition-all" style={{ color: '#1f375d' }}>
            Get in Touch
          </Link>
        </div>
      </section>
    </>
  )
}
