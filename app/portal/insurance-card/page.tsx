// app/portal/insurance-card/page.tsx
//
// W44 T6 — patient takes phone photos of insurance card front/back,
// uploads, reviews extracted fields, confirms or corrects.

'use client'

import { useEffect, useState } from 'react'

const FIELD_LABELS: Record<string, string> = {
  member_id: 'Member ID',
  group_number: 'Group #',
  member_name: 'Name on card',
  plan_name: 'Plan name',
  plan_type: 'Plan type',
  payer_name: 'Insurance company',
  effective_date: 'Effective date',
  rx_bin: 'RX BIN',
  rx_pcn: 'RX PCN',
  rx_group: 'RX group',
  customer_service_phone: 'Customer service',
  provider_service_phone: 'Provider service',
}

type ScanResponse = {
  scan_id: string
  parsed_fields: Record<string, string>
  field_confidence: Record<string, number>
  confidence: number
  suggested_review: boolean
  low_confidence_fields: string[]
}

export default function PortalInsuranceCardPage() {
  const [front, setFront] = useState<File | null>(null)
  const [back, setBack] = useState<File | null>(null)
  const [scan, setScan] = useState<ScanResponse | null>(null)
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [consented, setConsented] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Pre-load the most recent patient-self scan so a returning patient
  // sees their previous capture.
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/portal/insurance-card')
        if (!res.ok) return
        const j = await res.json()
        if (j.scan) {
          setScan({
            scan_id: j.scan.id,
            parsed_fields: j.scan.scan_data || {},
            field_confidence: j.scan.field_confidence || {},
            confidence: j.scan.confidence,
            suggested_review: false,
            low_confidence_fields: [],
          })
        }
      } catch {}
    })()
  }, [])

  async function upload() {
    if (!front && !back) return
    if (!consented) {
      setError('Please review and accept the consent before uploading.')
      return
    }
    setUploading(true)
    setError(null)
    try {
      const form = new FormData()
      if (front) form.append('card_front', front)
      if (back) form.append('card_back', back)
      const res = await fetch('/api/portal/insurance-card', {
        method: 'POST',
        body: form,
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || `Upload failed (${res.status})`)
      }
      const j = await res.json() as ScanResponse
      setScan(j)
      setEdits({})
      setConfirmed(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setUploading(false)
    }
  }

  async function confirm() {
    if (!scan) return
    setConfirming(true)
    setError(null)
    try {
      const res = await fetch('/api/portal/insurance-card/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scan_id: scan.scan_id, corrections: edits }),
      })
      if (!res.ok) throw new Error('Confirmation failed')
      setConfirmed(true)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setConfirming(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Insurance card</h1>
        <p className="text-sm text-gray-600 mt-1">
          Take a photo of the front and back of your insurance card.
          We'll read the details automatically — you'll be able to
          review and correct anything before submitting.
        </p>
      </div>

      <div className="rounded border border-gray-200 bg-blue-50 p-3 text-sm space-y-2">
        <p className="font-medium">How we use your photos</p>
        <p>
          The photo is encrypted at rest and used only to read the
          information on your card. Optical-character-recognition
          runs in our HIPAA-compliant cloud (AWS) and the photo is
          deleted after 90 days. We never share your card image with
          third parties.
        </p>
        <label className="flex items-start gap-2 mt-2">
          <input
            type="checkbox"
            checked={consented}
            onChange={(e) => setConsented(e.target.checked)}
            className="mt-0.5 h-4 w-4"
          />
          <span>I understand and consent to processing of my insurance card photos.</span>
        </label>
      </div>

      {error && (
        <div className="rounded bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      <section className="rounded border bg-white p-4 space-y-3">
        <h2 className="font-medium">Upload card photos</h2>
        <label className="block text-sm">
          Front of card
          <input
            type="file"
            accept="image/jpeg,image/png,image/heic,image/webp"
            capture="environment"
            onChange={(e) => setFront(e.target.files?.[0] || null)}
            className="block w-full mt-1"
          />
        </label>
        <label className="block text-sm">
          Back of card
          <input
            type="file"
            accept="image/jpeg,image/png,image/heic,image/webp"
            capture="environment"
            onChange={(e) => setBack(e.target.files?.[0] || null)}
            className="block w-full mt-1"
          />
        </label>
        <button
          onClick={upload}
          disabled={uploading || (!front && !back)}
          className="bg-[#1f375d] text-white px-3 py-1.5 rounded text-sm disabled:opacity-50"
        >
          {uploading ? 'Reading card…' : 'Upload + read card'}
        </button>
        <p className="text-xs text-gray-500">10 MB max per side.</p>
      </section>

      {scan && (
        <section className="rounded border bg-white p-4 space-y-3">
          <h2 className="font-medium">Review extracted information</h2>
          {scan.suggested_review && (
            <div className="rounded bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
              Some fields had low confidence. Please double-check
              {scan.low_confidence_fields.length > 0 && (
                <>: {scan.low_confidence_fields.map((k) => FIELD_LABELS[k] || k).join(', ')}</>
              )}.
            </div>
          )}

          <div className="space-y-2">
            {Object.keys(scan.parsed_fields).length === 0 ? (
              <p className="text-sm text-gray-500">
                We couldn't read any details. Try a clearer photo with
                better lighting and no glare.
              </p>
            ) : Object.entries(scan.parsed_fields).map(([k, v]) => (
              <label key={k} className="block text-sm">
                <span className="text-gray-700">{FIELD_LABELS[k] || k}</span>
                <input
                  type="text"
                  defaultValue={v}
                  onChange={(e) => setEdits({ ...edits, [k]: e.target.value })}
                  className="block w-full border rounded px-2 py-1 mt-0.5"
                />
                {scan.field_confidence[k] != null && scan.field_confidence[k] < 0.85 && (
                  <span className="text-xs text-amber-700">Low confidence — please verify</span>
                )}
              </label>
            ))}
          </div>

          <button
            onClick={confirm}
            disabled={confirming || confirmed}
            className="bg-[#1f375d] text-white px-3 py-1.5 rounded text-sm disabled:opacity-50"
          >
            {confirmed ? 'Submitted' : (confirming ? 'Submitting…' : 'Submit to my therapist')}
          </button>
          {confirmed && (
            <p className="text-xs text-green-700">
              Thanks — your therapist will review your card on their end.
            </p>
          )}
        </section>
      )}
    </div>
  )
}
