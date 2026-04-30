'use client'

import Link from 'next/link'
import { useState } from 'react'

const APP_URL = 'https://lab.harboroffice.ai'

export function MarketingNav() {
  const [open, setOpen] = useState(false)

  return (
    <nav className="bg-white border-b border-gray-100 px-6 py-4 sticky top-0 z-50 backdrop-blur supports-[backdrop-filter]:bg-white/90">
      <div className="max-w-6xl mx-auto flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
          <img src="/harbor-logo.svg" alt="Harbor" className="h-12 w-auto" />
        </Link>

        <div className="hidden md:flex items-center gap-7">
          <Link href="/reception" className="text-sm text-gray-600 hover:text-gray-900 font-medium">
            Product
          </Link>
          <Link href="/pricing" className="text-sm text-gray-600 hover:text-gray-900 font-medium">
            Pricing
          </Link>
          <Link href="/security" className="text-sm text-gray-600 hover:text-gray-900 font-medium">
            Security
          </Link>
          <Link href="/about" className="text-sm text-gray-600 hover:text-gray-900 font-medium">
            About
          </Link>
        </div>

        <div className="hidden md:flex items-center gap-4">
          <a
            href={`${APP_URL}/login`}
            className="text-sm text-gray-600 hover:text-gray-900 font-medium"
          >
            Log in
          </a>
          <Link
            href="/contact"
            className="text-white px-5 py-2 rounded-lg text-sm font-semibold transition-all hover:shadow-md"
            style={{ backgroundColor: '#1f375d' }}
          >
            Book a Demo
          </Link>
        </div>

        <button
          onClick={() => setOpen(!open)}
          className="md:hidden p-2 text-gray-700"
          aria-label="Toggle menu"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            {open ? (
              <path d="M6 18L18 6M6 6l12 12" strokeLinecap="round" />
            ) : (
              <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" />
            )}
          </svg>
        </button>
      </div>

      {open && (
        <div className="md:hidden mt-4 pb-2 space-y-2 border-t border-gray-100 pt-4">
          <Link href="/reception" className="block py-2 text-sm font-medium text-gray-700">Product</Link>
          <Link href="/pricing" className="block py-2 text-sm font-medium text-gray-700">Pricing</Link>
          <Link href="/security" className="block py-2 text-sm font-medium text-gray-700">Security</Link>
          <Link href="/about" className="block py-2 text-sm font-medium text-gray-700">About</Link>
          <a href={`${APP_URL}/login`} className="block py-2 text-sm font-medium text-gray-700">Log in</a>
          <Link
            href="/contact"
            className="block mt-3 px-4 py-2.5 rounded-lg text-sm font-semibold text-white text-center"
            style={{ backgroundColor: '#1f375d' }}
          >
            Book a Demo
          </Link>
        </div>
      )}
    </nav>
  )
}
