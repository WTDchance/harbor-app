// components/ehr/PortalLinkCard.tsx
// Therapist-side card on the patient profile: generate/rotate a portal
// login link, copy to clipboard, or send to the patient (email/SMS future).

'use client'

import { useState } from 'react'
import { Link2, Copy, RefreshCw, CheckCircle2 } from 'lucide-react'
import { usePreferences } from '@/lib/ehr/use-preferences'

export function PortalLinkCard({ patientId }: { patientId: string }) {
  const { prefs } = usePreferences()
  const [url, setUrl] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [copied, setCopied] = useState(false)
  if (prefs && prefs.features.portal === false) return null

  async function generate() {
    setGenerating(true)
    try {
      const res = await fetch(`/api/ehr/patients/${patientId}/portal-link`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed')
      setUrl(json.url)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed')
    } finally {
      setGenerating(false)
    }
  }

  async function copy() {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {}
  }

  return (
    <div className="bg-white border rounded-lg p-5 shadow-sm">
      <h2 className="font-semibold text-gray-900 flex items-center gap-2 mb-3">
        <Link2 className="w-4 h-4 text-gray-500" />
        Patient Portal Access
      </h2>
      {url ? (
        <div>
          <p className="text-xs text-gray-600 mb-2">
            Share this link with the patient. They can view upcoming appointments, sign pending consents, and see their treatment plan. Link expires in 30 days.
          </p>
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={url}
              onClick={(e) => (e.target as HTMLInputElement).select()}
              className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-xs font-mono bg-gray-50"
            />
            <button
              type="button"
              onClick={copy}
              className="inline-flex items-center gap-1 px-3 py-2 text-xs bg-teal-600 hover:bg-teal-700 text-white rounded-lg"
            >
              {copied ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <button
            type="button"
            onClick={generate}
            disabled={generating}
            className="mt-2 inline-flex items-center gap-1 text-xs text-gray-600 hover:text-gray-900"
          >
            <RefreshCw className={`w-3 h-3 ${generating ? 'animate-spin' : ''}`} />
            {generating ? 'Rotating…' : 'Rotate link (invalidates old)'}
          </button>
        </div>
      ) : (
        <div>
          <p className="text-sm text-gray-500 mb-3">
            Generate a secure link the patient can use to log in to their portal.
          </p>
          <button
            type="button"
            onClick={generate}
            disabled={generating}
            className="inline-flex items-center gap-2 text-sm bg-teal-600 hover:bg-teal-700 text-white px-3 py-1.5 rounded-md disabled:opacity-50"
          >
            <Link2 className="w-4 h-4" />
            {generating ? 'Generating…' : 'Generate portal link'}
          </button>
        </div>
      )}
    </div>
  )
}
