// app/portal/consents/page.tsx
//
// Wave 38 TS4 — patient portal: sign required consent documents.
// At first login the portal will route patients here when any required
// consent isn't yet signed for the latest version.

'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Loader2, FileText, CheckCircle2, ArrowRight } from 'lucide-react'

type DocRow = {
  id: string
  kind: string
  version: string
  body_md: string
  required: boolean
  effective_at: string
  signed_at: string | null
}

const KIND_LABEL: Record<string, string> = {
  hipaa_npp: 'HIPAA Notice of Privacy Practices',
  telehealth: 'Telehealth Consent',
  financial_responsibility: 'Financial Responsibility',
  roi: 'Release of Information',
}

export default function PortalConsentsPage() {
  const [docs, setDocs] = useState<DocRow[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [signedName, setSignedName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawing = useRef(false)

  async function load() {
    setLoading(true)
    try {
      const r = await fetch('/api/portal/consents')
      if (!r.ok) throw new Error('failed_to_load')
      const j = await r.json()
      setDocs(j.documents || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  // Canvas drawing helpers
  function point(e: React.MouseEvent | React.TouchEvent) {
    const c = canvasRef.current!
    const rect = c.getBoundingClientRect()
    const t = (e as any).touches?.[0]
    const x = (t ? t.clientX : (e as any).clientX) - rect.left
    const y = (t ? t.clientY : (e as any).clientY) - rect.top
    return { x: x * (c.width / rect.width), y: y * (c.height / rect.height) }
  }
  function startDraw(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault()
    drawing.current = true
    const ctx = canvasRef.current!.getContext('2d')!
    const p = point(e)
    ctx.beginPath()
    ctx.moveTo(p.x, p.y)
  }
  function moveDraw(e: React.MouseEvent | React.TouchEvent) {
    if (!drawing.current) return
    e.preventDefault()
    const ctx = canvasRef.current!.getContext('2d')!
    const p = point(e)
    ctx.lineTo(p.x, p.y)
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.strokeStyle = '#0f172a'
    ctx.stroke()
  }
  function endDraw() { drawing.current = false }
  function clearCanvas() {
    const c = canvasRef.current
    if (!c) return
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height)
  }

  function openSign(id: string) {
    setActiveId(id)
    setSignedName('')
    setError(null)
    setTimeout(() => clearCanvas(), 0)
  }

  async function submit() {
    if (!activeId) return
    const dataUrl = canvasRef.current!.toDataURL('image/png')
    if (dataUrl.length < 1000) {
      setError('Please draw your signature in the box.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const r = await fetch('/api/portal/consents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          document_id: activeId,
          signature_data_url: dataUrl,
          signed_name: signedName.trim() || null,
        }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'submit_failed')
      setActiveId(null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submit failed')
    } finally {
      setSubmitting(false)
    }
  }

  const unsignedRequired = (docs || []).filter(d => d.required && !d.signed_at)
  const allDone = !loading && unsignedRequired.length === 0

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-xl font-semibold text-gray-900 mb-1">Consents on file</h1>
        <p className="text-sm text-gray-600 mb-6">
          Please review and sign each required document before your first session.
        </p>

        {loading && (
          <div className="text-sm text-gray-500 inline-flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
          </div>
        )}

        {!loading && (docs || []).length === 0 && (
          <div className="text-sm text-gray-600 bg-white border border-gray-200 rounded-xl p-4">
            Your practice hasn&apos;t published consent documents yet. There&apos;s nothing for you to sign right now.
          </div>
        )}

        {!loading && (docs || []).length > 0 && (
          <div className="space-y-2">
            {docs!.map(d => (
              <div key={d.id} className="bg-white border border-gray-200 rounded-xl p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-gray-900 inline-flex items-center gap-1.5">
                      <FileText className="w-4 h-4 text-gray-500" />
                      {KIND_LABEL[d.kind] || d.kind}
                      <span className="ml-2 text-[10px] text-gray-500 uppercase tracking-wider">{d.version}</span>
                    </div>
                    {d.required && !d.signed_at && (
                      <div className="text-xs text-amber-700 mt-0.5">Required — please sign.</div>
                    )}
                    {d.signed_at && (
                      <div className="text-xs text-green-700 mt-0.5 inline-flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Signed {new Date(d.signed_at).toLocaleDateString()}
                      </div>
                    )}
                  </div>
                  {!d.signed_at && (
                    <button
                      type="button"
                      onClick={() => openSign(d.id)}
                      className="min-h-[44px] inline-flex items-center gap-1 bg-teal-600 hover:bg-teal-700 text-white text-sm px-3 py-2 rounded-lg"
                    >
                      Sign <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {activeId === d.id && (
                  <div className="mt-3 border-t border-gray-100 pt-3 space-y-3">
                    <div className="prose prose-sm max-w-none whitespace-pre-wrap text-gray-800 max-h-60 overflow-y-auto bg-gray-50 border border-gray-200 rounded-md p-3">
                      {d.body_md}
                    </div>
                    <input
                      value={signedName}
                      onChange={e => setSignedName(e.target.value)}
                      placeholder="Type your full legal name (optional)"
                      className="w-full text-sm border border-gray-200 rounded-md px-3 py-2"
                    />
                    <div>
                      <div className="text-xs text-gray-600 mb-1">Sign in the box below</div>
                      <canvas
                        ref={canvasRef}
                        width={600}
                        height={150}
                        className="w-full bg-white border border-gray-300 rounded-md touch-none"
                        onMouseDown={startDraw}
                        onMouseMove={moveDraw}
                        onMouseUp={endDraw}
                        onMouseLeave={endDraw}
                        onTouchStart={startDraw}
                        onTouchMove={moveDraw}
                        onTouchEnd={endDraw}
                      />
                      <button type="button" onClick={clearCanvas} className="text-xs text-gray-500 hover:text-gray-700 mt-1">
                        Clear signature
                      </button>
                    </div>
                    {error && <div className="text-sm text-red-700">{error}</div>}
                    <div className="flex gap-2 justify-end">
                      <button type="button" onClick={() => setActiveId(null)} className="min-h-[44px] px-3 py-2 text-sm text-gray-600 hover:text-gray-900">
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={submit}
                        disabled={submitting}
                        className="min-h-[44px] inline-flex items-center gap-1.5 px-3 py-2 text-sm bg-teal-600 hover:bg-teal-700 text-white rounded-lg disabled:opacity-50"
                      >
                        {submitting ? (<><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>) : 'Save signature'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {allDone && (
          <div className="mt-6 bg-green-50 border border-green-200 rounded-xl p-4">
            <div className="text-sm font-semibold text-green-900 inline-flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4" /> All set
            </div>
            <Link href="/portal/home" className="block mt-1 text-sm text-teal-700 hover:text-teal-900">
              Back to your portal →
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
