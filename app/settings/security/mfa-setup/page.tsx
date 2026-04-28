// app/settings/security/mfa-setup/page.tsx
//
// Wave 38 TS3 — TOTP enrollment for therapists. Generates a secret +
// QR code, walks them through scanning, then verifies a 6-digit code
// to lock TOTP in as the preferred MFA factor.
//
// Force-enrollment policy: any therapist (role = clinician/admin/owner)
// who hits this page after a Wave-38 deploy gets nudged here from the
// post-login interstitial. Patients have a separate flow + are not
// forced to enroll.

'use client'

import { useEffect, useState } from 'react'
import { Loader2, ShieldCheck, Copy, CheckCircle2 } from 'lucide-react'

export default function MfaSetupPage() {
  const [loading, setLoading] = useState(true)
  const [secret, setSecret] = useState<string | null>(null)
  const [otpUri, setOtpUri] = useState<string | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/auth/mfa-setup', { method: 'GET' })
        const j = await r.json()
        if (!r.ok) throw new Error(j.error || 'failed')
        setSecret(j.secret)
        setOtpUri(j.otpauth_uri)
        setQrDataUrl(j.qr_data_url || null)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not start MFA setup')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  async function verify(e: React.FormEvent) {
    e.preventDefault()
    setVerifying(true)
    setError(null)
    try {
      const r = await fetch('/api/auth/mfa-setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'verify_failed')
      setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed')
    } finally {
      setVerifying(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8">
      <div className="max-w-md mx-auto bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-9 h-9 rounded-full bg-teal-600 text-white flex items-center justify-center">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <div className="text-sm font-semibold text-gray-900">Set up two-factor</div>
            <div className="text-xs text-gray-500">Required for therapist accounts.</div>
          </div>
        </div>

        {loading && (
          <div className="text-sm text-gray-500 inline-flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            Generating your secret…
          </div>
        )}

        {!loading && !done && secret && (
          <div className="space-y-4">
            <ol className="text-sm text-gray-700 space-y-2 list-decimal pl-5">
              <li>Open Authy, 1Password, Google Authenticator, or any TOTP app.</li>
              <li>Add a new entry. Scan the QR code below, or paste the secret manually.</li>
              <li>Enter the 6-digit code your app shows to confirm setup.</li>
            </ol>

            {qrDataUrl ? (
              <div className="flex justify-center">
                <img
                  alt="MFA QR code"
                  className="w-48 h-48 border border-gray-200 rounded-lg bg-white"
                  src={qrDataUrl}
                />
              </div>
            ) : otpUri ? (
              <div className="text-xs text-gray-500 text-center px-4">
                QR rendering unavailable. Add the secret manually below.
              </div>
            ) : null}

            <div className="bg-gray-50 border border-gray-200 rounded-lg p-2 text-xs flex items-center justify-between gap-2">
              <code className="font-mono break-all">{secret}</code>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(secret).then(() => {
                    setCopied(true); setTimeout(() => setCopied(false), 1500)
                  })
                }}
                className="min-h-[44px] inline-flex items-center gap-1 px-2 py-1 text-xs text-teal-700 hover:text-teal-900"
                aria-label="Copy MFA secret"
              >
                {copied ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>

            <form onSubmit={verify} className="space-y-3">
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
                placeholder="123456"
                className="w-full text-center font-mono text-lg tracking-widest border border-gray-300 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
              <button
                type="submit"
                disabled={verifying || code.length !== 6}
                className="w-full py-2.5 bg-teal-600 hover:bg-teal-700 text-white font-medium rounded-lg disabled:bg-gray-300 min-h-[44px] inline-flex items-center justify-center gap-2"
              >
                {verifying ? (<><Loader2 className="w-4 h-4 animate-spin" /> Verifying…</>) : 'Confirm and turn on MFA'}
              </button>
            </form>

            {error && <div className="text-sm text-red-700">{error}</div>}
          </div>
        )}

        {done && (
          <div className="text-sm text-green-800 bg-green-50 border border-green-200 rounded-lg p-3">
            <div className="font-semibold mb-1 inline-flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4" /> Two-factor is on
            </div>
            From now on every Harbor login will ask for a 6-digit code from your authenticator.
            <a href="/dashboard" className="block mt-3 text-teal-700 hover:text-teal-900 font-medium">Back to Today →</a>
          </div>
        )}
      </div>
    </div>
  )
}
