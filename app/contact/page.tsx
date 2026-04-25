'use client'

import Link from 'next/link'
import { useEffect } from 'react'

// TODO: Replace with your actual Cal.com username/event-slug
const CAL_LINK = 'harborreceptionist/demo'

export default function ContactPage() {
  useEffect(() => {
    // Load Cal.com embed script
    const script = document.createElement('script')
    script.src = 'https://app.cal.com/embed/embed.js'
    script.async = true
    document.head.appendChild(script)

    script.onload = () => {
      // @ts-ignore — Cal global injected by embed script
      if (typeof window !== 'undefined' && (window as any).Cal) {
        ;(window as any).Cal('init', { origin: 'https://cal.com' })
        ;(window as any).Cal('inline', {
          calLink: CAL_LINK,
          elementOrSelector: '#cal-embed',
          layout: 'month_view',
        })
        ;(window as any).Cal('ui', {
          styles: { branding: { brandColor: '#1f375d' } },
          hideEventTypeDetails: false,
          layout: 'month_view',
        })
      }
    }

    return () => {
      // Cleanup: remove the script if navigating away
      if (script.parentNode) script.parentNode.removeChild(script)
    }
  }, [])

  return (
    <div className="min-h-screen bg-white">
      {/* Nav */}
      <nav className="bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between sticky top-0 z-50">
        <Link href="/" className="hover:opacity-80 transition-opacity">
          <img src="/harbor-logo.svg" alt="Harbor" className="h-14 w-auto" />
        </Link>
        <div className="flex items-center gap-6">
          <Link href="/#how-it-works" className="text-sm text-gray-500 hover:text-gray-900 hidden sm:block">How It Works</Link>
          <Link href="/#pricing" className="text-sm text-gray-500 hover:text-gray-900 hidden sm:block">Pricing</Link>
          <Link href="/login" className="text-sm text-gray-600 hover:text-gray-900">Log in</Link>
          <Link href="/signup" className="text-white px-5 py-2 rounded-lg text-sm font-semibold transition-all hover:shadow-lg" style={{ backgroundColor: '#1f375d' }}>
            Get Started
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="px-6 py-16 text-center" style={{ background: 'linear-gradient(135deg, #1f375d 0%, #3e85af 50%, #52bfc0 100%)' }}>
        <div className="max-w-2xl mx-auto">
          <h1 className="text-4xl font-bold text-white mb-4">Book a Demo</h1>
          <p className="text-white/80 text-lg">
            See how Harbor answers calls, screens patients, and handles intake &mdash; all in 15 minutes.
          </p>
        </div>
      </section>

      {/* Cal.com embed + fallback */}
      <section className="px-6 py-16">
        <div className="max-w-4xl mx-auto">
          <div
            id="cal-embed"
            style={{
              width: '100%',
              minHeight: 500,
              overflow: 'auto',
              borderRadius: 12,
            }}
          />

          {/* Fallback if embed doesn't load */}
          <noscript>
            <div className="text-center py-12">
              <p className="text-gray-600 mb-4">Please enable JavaScript to use our booking calendar, or book directly:</p>
              <a
                href={`https://cal.com/${CAL_LINK}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block text-white font-bold px-8 py-4 rounded-xl text-lg"
                style={{ backgroundColor: '#1f375d' }}
              >
                Book on Cal.com
              </a>
            </div>
          </noscript>
        </div>
      </section>

      {/* Alternative contact methods */}
      <section className="px-6 py-16 bg-gray-50">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-2xl font-bold mb-6" style={{ color: '#1f375d' }}>Prefer to reach out directly?</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white rounded-2xl p-6 border border-gray-200">
              <div className="text-3xl mb-3">&#9993;</div>
              <h3 className="font-semibold mb-2" style={{ color: '#1f375d' }}>Email Us</h3>
              <a href="mailto:hello@harborreceptionist.com" className="text-sm hover:underline" style={{ color: '#3e85af' }}>
                hello@harborreceptionist.com
              </a>
              <p className="text-xs text-gray-400 mt-2">We respond within a few hours</p>
            </div>
            <div className="bg-white rounded-2xl p-6 border border-gray-200">
              <div className="text-3xl mb-3">&#128172;</div>
              <h3 className="font-semibold mb-2" style={{ color: '#1f375d' }}>Quick Questions?</h3>
              <p className="text-sm text-gray-500">
                Already a Harbor practice? Use the <strong>Support</strong> page in your dashboard for the fastest response.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-100 px-6 py-10 bg-white">
        <div className="max-w-4xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div>
            <Link href="/" className="hover:opacity-80 transition-opacity">
              <img src="/harbor-logo.svg" alt="Harbor" className="h-12 w-auto" />
            </Link>
            <p className="text-xs text-gray-400 mt-1">AI receptionist for therapy practices</p>
          </div>
          <div className="flex gap-4 text-xs text-gray-500">
            <Link href="/privacy-policy" className="hover:text-gray-900">Privacy Policy</Link>
            <Link href="/sms" className="hover:text-gray-900">SMS Terms</Link>
            <Link href="/terms" className="hover:text-gray-900">Terms of Service</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
