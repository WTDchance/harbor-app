import Link from 'next/link'

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white">
      {/* Nav */}
      <nav className="border-b border-gray-100 px-6 py-4 flex items-center justify-between">
        <span className="text-2xl font-bold text-teal-600">Harbor</span>
        <div className="flex items-center gap-4">
          <Link href="/login" className="text-sm text-gray-600 hover:text-gray-900">Log in</Link>
          <Link href="/onboard" className="bg-teal-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-teal-700 transition-colors">Get Started</Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="bg-gradient-to-br from-teal-600 to-teal-800 text-white px-6 py-24 text-center">
        <div className="max-w-4xl mx-auto">
          <div className="inline-flex items-center gap-2 bg-teal-500/30 text-teal-100 text-sm px-4 py-1.5 rounded-full mb-6">
            <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></span>
            AI receptionist — live 24/7
          </div>
          <h1 className="text-5xl font-bold mb-6 leading-tight">Your practice never<br />misses a call again</h1>
          <p className="text-xl text-teal-100 mb-10 max-w-2xl mx-auto">Harbor gives every therapy practice a warm, intelligent AI receptionist who answers calls, screens new patients, and sends you a full summary — so you can focus on your clients.</p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/onboard" className="bg-white text-teal-700 px-8 py-3.5 rounded-xl font-semibold text-lg hover:bg-teal-50 transition-colors">Get Started Free →</Link>
            <a href="#how-it-works" className="border border-teal-400 text-white px-8 py-3.5 rounded-xl font-semibold text-lg hover:bg-teal-700 transition-colors">See How It Works</a>
          </div>
          <p className="text-teal-300 mt-6 text-sm">$97/month founding (reg. $297) · 20 spots · Setup in 5 minutes</p>
        </div>
      </section>

      {/* Social proof */}
      <section className="border-b border-gray-100 px-6 py-8">
        <div className="max-w-4xl mx-auto">
          <p className="text-center text-sm text-gray-400 mb-6">Trusted by therapy practices across the US</p>
          <div className="flex flex-wrap justify-center gap-8 text-gray-300 font-semibold text-sm">
            {["Hope & Harmony Counseling", "Westside Therapy", "Clarity Mental Health", "Mindful Path Wellness", "Pacific Crest Therapy"].map(name => (
              <span key={name}>{name}</span>
            ))}
          </div>
        </div>
      </section>

      {/* Problem */}
      <section className="px-6 py-20 bg-gray-50">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl font-bold text-gray-900 mb-4">Every missed call is a missed patient</h2>
          <p className="text-gray-500 mb-12 text-lg">Therapy practices lose clients before the first session even begins.</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              { stat: "67%", text: "of callers don't leave voicemails when they reach one" },
              { stat: "1st", text: "practice to answer gets the new patient — not the best fit" },
              { stat: "24/7", text: "people seek help outside business hours, and you miss them" },
            ].map(({ stat, text }) => (
              <div key={stat} className="bg-white rounded-2xl p-6 border border-gray-200 text-center">
                <p className="text-4xl font-bold text-teal-600 mb-2">{stat}</p>
                <p className="text-gray-600 text-sm">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="px-6 py-20">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">Live in minutes. Running forever.</h2>
            <p className="text-gray-500 text-lg">From signup to your first answered call in under 5 minutes.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              { step: "01", title: "We personalize your AI", desc: "Tell us your specialties, hours, insurance, and location. We build a custom AI receptionist tuned to your practice." },
              { step: "02", title: "Ellie answers every call", desc: "Warm, calm, and professional — Ellie greets callers, answers questions, collects intake info, and screens new patients." },
              { step: "03", title: "You get a full summary", desc: "After every call: caller info, AI summary, PHQ-2/GAD-2 scores, appointment request, and full transcript in your inbox." },
            ].map(({ step, title, desc }) => (
              <div key={step} className="relative">
                <div className="text-5xl font-bold text-teal-100 mb-4">{step}</div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">{title}</h3>
                <p className="text-gray-500 text-sm">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="px-6 py-20 bg-gray-50">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">Built for therapy practices, specifically</h2>
            <p className="text-gray-500 text-lg">Not a generic chatbot. A clinical-context AI receptionist.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {[
              { icon: "🚨", title: "Crisis Detection", desc: "Ellie recognizes warning signs in real time, provides 988 resources, and immediately texts you — no other platform does this." },
              { icon: "🧠", title: "Mental Health Screening", desc: "PHQ-2 and GAD-2 scores collected during intake calls and sent to you before the first session." },
              { icon: "📱", title: "Smart Waitlist Filling", desc: "When an appointment cancels, Ellie texts the next patient automatically. They have 10 minutes to claim the slot." },
              { icon: "📧", title: "Post-Call Summaries", desc: "Every call generates a full transcript, AI summary, and action items delivered to your inbox." },
              { icon: "⚙️", title: "Real-Time Updates", desc: "Change your hours, specialties, or availability in your settings dashboard — Ellie updates instantly." },
              { icon: "🔒", title: "Privacy-Conscious Design", desc: "Built with HIPAA-conscious architecture. Your patient data stays yours." },
            ].map(({ icon, title, desc }) => (
              <div key={title} className="bg-white rounded-2xl p-5 border border-gray-200">
                <div className="text-3xl mb-3">{icon}</div>
                <h3 className="font-semibold text-gray-900 mb-1">{title}</h3>
                <p className="text-sm text-gray-500">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonial */}
      <section className="px-6 py-20">
        <div className="max-w-2xl mx-auto text-center">
          <div className="text-4xl mb-6">💬</div>
          <blockquote className="text-xl text-gray-700 italic mb-6">
            "I used to miss 3–4 calls a week. Now Ellie handles everything — she even screens new patients with mental health questions before I meet them. It's like having a full-time receptionist for a fraction of the cost."
          </blockquote>
          <div className="font-semibold text-gray-900">Dr. Sarah M.</div>
          <div className="text-sm text-gray-500">Licensed Therapist · Seattle, WA</div>
        </div>
      </section>

      {/* Pricing */}
      <section className="py-20 px-4 bg-white">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-3xl font-bold text-gray-900 mb-3">Everything included. One price.</h2>
          <p className="text-gray-500 mb-10 text-lg">No tiers. No add-ons. No surprises.</p>

          {/* Founding Practice Banner */}
          <div className="bg-orange-50 border border-orange-200 rounded-2xl p-4 mb-8">
            <p className="text-orange-700 font-semibold text-sm">
              🔒 Founding Practice Offer — First 50 practices only
            </p>
            <p className="text-orange-600 text-sm mt-1">Lock in $97/mo forever — only 20 spots available. Price never increases, even as we add features.</p>
          </div>

          {/* Pricing Card */}
          <div className="border-2 border-teal-500 rounded-2xl p-10 shadow-lg relative">
            <div className="absolute -top-4 left-1/2 -translate-x-1/2">
              <span className="bg-teal-500 text-white text-xs font-bold px-4 py-1.5 rounded-full uppercase tracking-wide">Founding Practice</span>
            </div>

            <div className="mt-2 mb-2">
              <span className="text-gray-400 line-through text-2xl mr-2">$297</span>
              <span className="text-6xl font-bold text-gray-900">$97</span>
              <span className="text-gray-500 text-xl">/month</span>
            </div>
            <p className="text-gray-500 mb-8">Locked in forever for founding practices</p>

            <ul className="text-left space-y-3 mb-10 max-w-sm mx-auto">
              <li className="flex items-center gap-3 text-gray-700"><span className="text-teal-500 font-bold text-lg">✓</span> AI receptionist answers every call, 24/7</li>
              <li className="flex items-center gap-3 text-gray-700"><span className="text-teal-500 font-bold text-lg">✓</span> Appointment booking &amp; calendar sync</li>
              <li className="flex items-center gap-3 text-gray-700"><span className="text-teal-500 font-bold text-lg">✓</span> Automated SMS reminders</li>
              <li className="flex items-center gap-3 text-gray-700"><span className="text-teal-500 font-bold text-lg">✓</span> Bulk patient messaging</li>
              <li className="flex items-center gap-3 text-gray-700"><span className="text-teal-500 font-bold text-lg">✓</span> Insurance eligibility tracking</li>
              <li className="flex items-center gap-3 text-gray-700"><span className="text-teal-500 font-bold text-lg">✓</span> Full patient dashboard</li>
              <li className="flex items-center gap-3 text-gray-700"><span className="text-teal-500 font-bold text-lg">✓</span> 30-day money-back guarantee</li>
            </ul>

            <a href="/register" className="block w-full text-center bg-teal-600 hover:bg-teal-700 text-white font-bold py-4 rounded-xl text-lg transition-colors">
              Claim Your Founding Practice Spot
            </a>
            <p className="text-gray-400 text-sm mt-3">No contracts. Cancel anytime. Regular price $297/mo after founding spots fill.</p>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="px-6 py-20">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-3xl font-bold text-gray-900 text-center mb-10">Frequently asked questions</h2>
          <div className="space-y-6">
            {[
              { q: "How long does setup take?", a: "Under 5 minutes. Fill out your practice details, and Ellie is live before you finish your coffee." },
              { q: "Will patients know they're talking to an AI?", a: "Yes. Ellie is warm and human-sounding, but she's transparent that she's an AI assistant. Most patients appreciate the quick response." },
              { q: "What happens during a crisis call?", a: "Ellie provides the 988 Suicide & Crisis Lifeline, encourages the caller to seek immediate help, and sends you an urgent SMS alert — all in real time." },
              { q: "Can I customize what Ellie says?", a: "Yes. Your settings dashboard lets you update hours, specialties, location, and more. Every change syncs to Ellie instantly." },
              { q: "Is this HIPAA compliant?", a: "Harbor is built with HIPAA-conscious practices. We recommend consulting your own compliance counsel and establishing a BAA as appropriate for your practice." },
            ].map(({ q, a }) => (
              <div key={q} className="border-b border-gray-100 pb-6">
                <h3 className="font-semibold text-gray-900 mb-2">{q}</h3>
                <p className="text-gray-500 text-sm">{a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-100 px-6 py-10">
        <div className="max-w-4xl mx-auto">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4 mb-6 pb-6 border-b border-gray-100">
            <div>
              <span className="text-xl font-bold text-teal-600">Harbor</span>
              <p className="text-xs text-gray-400 mt-1">AI receptionist for therapy practices</p>
            </div>
            <div className="flex gap-6 text-sm text-gray-500">
              <Link href="/login" className="hover:text-gray-900">Log in</Link>
              <Link href="/onboard" className="hover:text-gray-900">Get Started</Link>
            </div>
          </div>
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-xs text-gray-400">© 2026 Harbor AI. All rights reserved.</p>
            <div className="flex gap-4 text-xs text-gray-500">
              <Link href="/privacy" className="hover:text-gray-900">Privacy Policy</Link>
              <Link href="/terms" className="hover:text-gray-900">Terms of Service</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
