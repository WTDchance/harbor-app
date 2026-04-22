// components/ehr/ComingSoon.tsx
// Shown when a user lands on an EHR page for a practice that doesn't
// have ehr_enabled = true. We keep the surface area explicit so it's
// obvious we don't silently half-work.

import { Sparkles } from 'lucide-react'
import Link from 'next/link'

export function EhrComingSoon({ feature }: { feature: string }) {
  return (
    <div className="max-w-xl mx-auto mt-16">
      <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-teal-50 text-teal-700 mb-4">
          <Sparkles className="w-6 h-6" />
        </div>
        <h1 className="text-xl font-semibold text-gray-900 mb-2">
          {feature} — coming soon
        </h1>
        <p className="text-sm text-gray-600 mb-6">
          Harbor EHR isn&apos;t turned on for your practice yet. Reach out to
          support and we&apos;ll switch it on.
        </p>
        <Link
          href="/dashboard"
          className="inline-block px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium rounded-lg"
        >
          Back to dashboard
        </Link>
      </div>
    </div>
  )
}
