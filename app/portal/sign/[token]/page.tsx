// app/portal/sign/[token]/page.tsx
//
// W52 D1 — patient-facing signing page.

'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

interface RequestRow {
  id: string
  status: 'viewed' | 'signed' | 'expired' | 'withdrawn' | 'pending'
  body_html: string
  template_name: string
  category: string
  signed_at: string | null
}

export default function PortalSignPage() {
  const params = useParams<{ token: string }>()
  const token = params.token
  const [request, setRequest] = useState<RequestRow | null>(null)
  const [signerFirst, setSignerFirst] = useState('')
  const [signerLast, setSignerLast] = useState('')
  const [practiceName, setPracticeName] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [agree, setAgree] = useState(false)
  const [typedSignature, setTypedSignature] = useState('')
  const [verifyDob, setVerifyDob] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [identityVerified, setIdentityVerified] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/portal/sign/${token}`)
      .then(r => r.json().then(j => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (cancelled) return
        if (!ok) {
          setError(j.error === 'expired' ? 'This link has expired.'
            : j.error === 'withdrawn' ? 'This document was withdrawn.'
            : j.error === 'not_found' ? 'This link is invalid.'
            : 'Could not load.')
        } else {
          setRequest(j.request)
          setSignerFirst(j.signer?.first_name ?? '')
          setSignerLast(j.signer?.last_name ?? '')
          setPracticeName(j.practice?.name ?? 'your provider')
          if (j.request.status === 'signed') setDone(true)
          // Prefill the typed signature with the recipient name as a starting point.
          if (!typedSignature) {
            setTypedSignature([j.signer?.first_name, j.signer?.last_name].filter(Boolean).join(' '))
          }
        }
      })
      .catch(() => { if (!cancelled) setError('Network error') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [token])

  async function submit() {
    if (!agree || !typedSignature.trim()) return
    setSubmitting(true); setError(null)
    try {
      const r = await fetch(`/api/portal/sign/${token}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          signer_name: typedSignature.trim(),
          signature_method: 'typed',
          signature_data: typedSignature.trim(),
          i_agree: true,
          verify_dob: verifyDob || null,
        }),
      })
      const j = await r.json()
      if (!r.ok) setError(j.error || 'Submission failed')
      else { setDone(true); setIdentityVerified(j.identity_verified) }
    } finally { setSubmitting(false) }
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center text-sm text-gray-500">Loading…</div>

  if (error || !request) return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="max-w-md text-center bg-white border border-red-200 rounded-xl p-8">
        <h1 className="text-lg font-semibold text-red-700">Cannot open document</h1>
        <p className="text-sm text-gray-600 mt-2">{error}</p>
      </div>
    </div>
  )

  if (done) return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="max-w-md text-center bg-white border border-green-200 rounded-xl p-8">
        <h1 className="text-lg font-semibold text-green-700">Signed — thank you</h1>
        <p className="text-sm text-gray-600 mt-2">Your signed copy was sent to {practiceName}.</p>
        {identityVerified === false && (
          <p className="text-xs text-amber-700 mt-3">Note: we couldn't verify your date of birth match. Your provider may follow up.</p>
        )}
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-3xl mx-auto bg-white rounded-xl border border-gray-200 p-6 sm:p-8">
        <div className="text-xs uppercase tracking-wide text-gray-500">{practiceName}</div>
        <h1 className="text-2xl font-semibold text-gray-900 mt-1">{request.template_name}</h1>
        <p className="text-xs text-gray-500 mt-1">For: {signerFirst} {signerLast}</p>

        <div className="prose prose-sm max-w-none mt-6 border border-gray-200 rounded-md p-4 bg-gray-50/50"
          dangerouslySetInnerHTML={{ __html: request.body_html }} />

        <div className="mt-6 space-y-4 border-t pt-5">
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Verify your date of birth (YYYY-MM-DD)</span>
            <input type="date" value={verifyDob} onChange={e => setVerifyDob(e.target.value)}
              className="mt-1 w-full border border-gray-300 rounded px-3 py-2 text-sm" />
            <span className="text-xs text-gray-400">Optional but speeds up verification.</span>
          </label>

          <label className="block">
            <span className="text-sm font-medium text-gray-700">Type your full legal name to sign</span>
            <input type="text" value={typedSignature} onChange={e => setTypedSignature(e.target.value)}
              className="mt-1 w-full border border-gray-300 rounded px-3 py-2 text-sm font-serif italic" />
          </label>

          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} />
            <span>I agree that my typed name above represents my signature, and I consent to sign this document electronically per the federal ESIGN Act.</span>
          </label>

          {error && <div className="text-sm text-red-600">{error}</div>}

          <button onClick={submit} disabled={!agree || !typedSignature.trim() || submitting}
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-md disabled:opacity-50">
            {submitting ? 'Signing…' : 'Sign document'}
          </button>
          <p className="text-[11px] text-gray-400">Your IP address, browser, and timestamp are recorded for audit purposes.</p>
        </div>
      </div>
    </div>
  )
}
