'use client'

// Wave 43 / T0 — public new-patient inquiry page. Unauthenticated.
// POSTs to /api/schedule/[slug]/inquiry. Simple form; intentionally
// minimal so a stranger can't fingerprint the practice's PHI.

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { Calendar, Check, AlertCircle } from 'lucide-react'

export default function PublicSchedulePage() {
  const params = useParams()
  const slug = String(params.slug)

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (!name || (!email && !phone)) {
      setError('Please share your name and either email or phone.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/schedule/${slug}/inquiry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inquirer_name: name,
          inquirer_email: email || null,
          inquirer_phone: phone || null,
          reason: reason || null,
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setError(data?.error?.message || `Couldn't send inquiry (${res.status}).`)
        return
      }
      setSuccess(true)
    } finally {
      setSubmitting(false)
    }
  }

  if (success) {
    return (
      <main className="max-w-md mx-auto px-4 py-12 text-center">
        <div className="w-12 h-12 mx-auto rounded-full bg-green-100 flex items-center justify-center">
          <Check className="w-6 h-6 text-green-700" />
        </div>
        <h1 className="text-2xl font-semibold text-gray-900 mt-4">Inquiry sent</h1>
        <p className="text-sm text-gray-600 mt-3">
          Thanks for reaching out. The practice will be in touch soon, usually within
          one or two business days.
        </p>
      </main>
    )
  }

  return (
    <main className="max-w-md mx-auto px-4 py-8">
      <div className="text-center mb-6">
        <Calendar className="w-10 h-10 mx-auto text-teal-600" />
        <h1 className="text-2xl font-semibold text-gray-900 mt-3">Get in touch</h1>
        <p className="text-sm text-gray-500 mt-1">
          Share a few details and the practice will reach out to schedule.
        </p>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />{error}
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Your name</label>
          <input value={name} onChange={(e) => setName(e.target.value)}
                 className="w-full p-3 text-base border border-gray-200 rounded-lg" style={{ minHeight: 48 }} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                 placeholder="optional if you provide phone"
                 className="w-full p-3 text-base border border-gray-200 rounded-lg" style={{ minHeight: 48 }} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
          <input value={phone} onChange={(e) => setPhone(e.target.value)}
                 placeholder="optional if you provide email"
                 className="w-full p-3 text-base border border-gray-200 rounded-lg" style={{ minHeight: 48 }} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">What brings you in? (optional)</label>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3}
                    placeholder="A few sentences is plenty."
                    className="w-full p-3 text-base border border-gray-200 rounded-lg" />
        </div>
        <button onClick={submit} disabled={submitting || !name || (!email && !phone)}
                className="w-full px-4 py-3 text-base font-medium text-white bg-teal-600 rounded-lg disabled:opacity-60"
                style={{ minHeight: 48 }}>
          {submitting ? 'Sending…' : 'Send inquiry'}
        </button>
        <p className="text-xs text-gray-500 text-center">
          Don't share medical or sensitive details here. The practice will use a secure channel for that conversation.
        </p>
      </div>
    </main>
  )
}
