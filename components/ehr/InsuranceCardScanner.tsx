// components/ehr/InsuranceCardScanner.tsx
//
// Wave 42 — phone-first insurance-card scanner.
//
// Therapist taps "Update from card" on a patient's profile, snaps front
// (and optionally back) of the insurance card with the phone camera,
// the API uploads to S3 + Textracts the form, and we render an
// editable review screen. Therapist confirms (low-confidence fields are
// highlighted yellow) and we patch the patient row.
//
// HIPAA: no AI suggestions to the patient, no Twilio/Vapi — this is a
// therapist-only tool. Tap targets ≥44px, thumbnails ≤200px tap-to-expand.

'use client'

import { useState } from 'react'
import {
  Camera,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  X,
  RefreshCw,
} from 'lucide-react'

type ParsedFields = Partial<Record<InsuranceFieldKey, string>>

const FIELD_KEYS = [
  'member_id',
  'group_number',
  'member_name',
  'plan_name',
  'plan_type',
  'payer_name',
  'effective_date',
  'rx_bin',
  'rx_pcn',
  'rx_group',
  'customer_service_phone',
  'provider_service_phone',
] as const
type InsuranceFieldKey = (typeof FIELD_KEYS)[number]

const FIELD_LABELS: Record<InsuranceFieldKey, string> = {
  member_id: 'Member ID',
  group_number: 'Group number',
  member_name: 'Member name',
  plan_name: 'Plan name',
  plan_type: 'Plan type',
  payer_name: 'Payer / carrier',
  effective_date: 'Effective date',
  rx_bin: 'RX BIN',
  rx_pcn: 'RX PCN',
  rx_group: 'RX Group',
  customer_service_phone: 'Customer service phone',
  provider_service_phone: 'Provider service phone',
}

// Which canonical fields map to which patient columns. Only these are
// patched into the patient row on Save — everything else is captured on
// the scan record but isn't yet a column on patients.
const PATIENT_COLUMN_MAP: Partial<Record<InsuranceFieldKey, string>> = {
  payer_name: 'insurance_provider',
  member_id: 'insurance_member_id',
  group_number: 'insurance_group_number',
}

type ScanResponse = {
  scan_id: string
  parsed_fields: ParsedFields
  field_confidence: Record<string, number>
  confidence: number | null
  original_s3_keys: { front: string | null; back: string | null }
  suggested_review: boolean
  low_confidence_fields: InsuranceFieldKey[]
}

type Props = {
  patientId: string
  onSaved?: (scanId: string, fields: ParsedFields) => void
  onCancel?: () => void
}

type Stage = 'idle' | 'capturing' | 'scanning' | 'review' | 'saving' | 'saved' | 'error'

export function InsuranceCardScanner({ patientId, onSaved, onCancel }: Props) {
  const [stage, setStage] = useState<Stage>('idle')
  const [errMsg, setErrMsg] = useState<string | null>(null)

  const [frontFile, setFrontFile] = useState<File | null>(null)
  const [backFile, setBackFile] = useState<File | null>(null)
  const [frontPreview, setFrontPreview] = useState<string | null>(null)
  const [backPreview, setBackPreview] = useState<string | null>(null)
  const [zoomed, setZoomed] = useState<string | null>(null)

  const [scan, setScan] = useState<ScanResponse | null>(null)
  const [edited, setEdited] = useState<ParsedFields>({})

  function pickFile(side: 'front' | 'back', f: File | null) {
    if (!f) return
    if (side === 'front') {
      setFrontFile(f)
      setFrontPreview(URL.createObjectURL(f))
    } else {
      setBackFile(f)
      setBackPreview(URL.createObjectURL(f))
    }
    setStage('capturing')
  }

  async function runScan() {
    if (!frontFile && !backFile) {
      setErrMsg('Please capture at least one side of the card.')
      return
    }
    setErrMsg(null)
    setStage('scanning')
    try {
      const fd = new FormData()
      if (frontFile) fd.append('card_front', frontFile, 'front.jpg')
      if (backFile) fd.append('card_back', backFile, 'back.jpg')
      const res = await fetch(`/api/ehr/patients/${patientId}/insurance-card`, {
        method: 'POST',
        body: fd,
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || json.detail || 'Scan failed')
      setScan(json as ScanResponse)
      setEdited({ ...(json as ScanResponse).parsed_fields })
      setStage('review')
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'Scan failed')
      setStage('error')
    }
  }

  function setField(k: InsuranceFieldKey, v: string) {
    setEdited(prev => ({ ...prev, [k]: v }))
  }

  async function save() {
    if (!scan) return
    setStage('saving')
    try {
      const patch: Record<string, string | null> = {}
      for (const k of FIELD_KEYS) {
        const col = PATIENT_COLUMN_MAP[k]
        if (!col) continue
        // Only patch columns the user actually has a value for; empty
        // string clears the column.
        if (k in edited) patch[col] = (edited[k] ?? '').trim() || null
      }
      patch['insurance_card_scan_id' as keyof typeof patch] = scan.scan_id

      const res = await fetch(`/api/patients/${patientId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!res.ok) {
        // Non-fatal — the scan row is already persisted with the parsed
        // fields. The therapist can re-run later. Surface the error
        // so they know nothing was written to the patient row.
        const json = await res.json().catch(() => ({}))
        throw new Error(json.error || `Save failed (${res.status})`)
      }
      setStage('saved')
      onSaved?.(scan.scan_id, edited)
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'Save failed')
      setStage('error')
    }
  }

  function reset() {
    setFrontFile(null)
    setBackFile(null)
    if (frontPreview) URL.revokeObjectURL(frontPreview)
    if (backPreview) URL.revokeObjectURL(backPreview)
    setFrontPreview(null)
    setBackPreview(null)
    setScan(null)
    setEdited({})
    setErrMsg(null)
    setStage('idle')
  }

  return (
    <div className="bg-white border rounded-lg p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-gray-900 flex items-center gap-2">
          <Camera className="w-4 h-4 text-gray-500" />
          Scan insurance card
        </h2>
        {onCancel && stage !== 'scanning' && stage !== 'saving' && (
          <button
            type="button"
            onClick={onCancel}
            className="text-gray-500 hover:text-gray-700 p-2 -mr-2"
            style={{ minWidth: 44, minHeight: 44 }}
            aria-label="Close scanner"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* IDLE / CAPTURING */}
      {(stage === 'idle' || stage === 'capturing' || stage === 'error') && (
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Snap the front of the insurance card. Add the back too if it has
            RX BIN / phone numbers.
          </p>

          <CardSidePicker
            label="Front"
            preview={frontPreview}
            onPick={f => pickFile('front', f)}
            onClear={() => {
              if (frontPreview) URL.revokeObjectURL(frontPreview)
              setFrontFile(null)
              setFrontPreview(null)
            }}
            onZoom={() => frontPreview && setZoomed(frontPreview)}
          />

          <CardSidePicker
            label="Back (optional)"
            preview={backPreview}
            onPick={f => pickFile('back', f)}
            onClear={() => {
              if (backPreview) URL.revokeObjectURL(backPreview)
              setBackFile(null)
              setBackPreview(null)
            }}
            onZoom={() => backPreview && setZoomed(backPreview)}
          />

          {errMsg && (
            <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{errMsg}</span>
            </div>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={runScan}
              disabled={!frontFile && !backFile}
              className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white font-medium rounded-lg px-4 py-3"
              style={{ minHeight: 44 }}
            >
              Scan card
            </button>
            {(frontFile || backFile) && (
              <button
                type="button"
                onClick={reset}
                className="text-gray-700 hover:bg-gray-100 rounded-lg px-4 py-3"
                style={{ minHeight: 44 }}
              >
                Reset
              </button>
            )}
          </div>
        </div>
      )}

      {/* SCANNING */}
      {stage === 'scanning' && (
        <div className="py-10 flex flex-col items-center text-gray-700">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600 mb-3" />
          <div className="font-medium">Reading the card…</div>
          <div className="text-xs text-gray-500 mt-1">Uploading + extracting fields</div>
        </div>
      )}

      {/* REVIEW */}
      {(stage === 'review' || stage === 'saving' || stage === 'saved') && scan && (
        <div className="space-y-4">
          {scan.suggested_review && (
            <div className="flex items-start gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <div>
                Some fields were unclear. Please verify the highlighted
                values before saving.
              </div>
            </div>
          )}

          {/* Thumbnails */}
          {(frontPreview || backPreview) && (
            <div className="flex gap-3">
              {frontPreview && (
                <img
                  src={frontPreview}
                  alt="Card front"
                  onClick={() => setZoomed(frontPreview)}
                  className="rounded-lg border border-gray-200 cursor-zoom-in"
                  style={{ maxWidth: 200, maxHeight: 130, objectFit: 'cover' }}
                />
              )}
              {backPreview && (
                <img
                  src={backPreview}
                  alt="Card back"
                  onClick={() => setZoomed(backPreview)}
                  className="rounded-lg border border-gray-200 cursor-zoom-in"
                  style={{ maxWidth: 200, maxHeight: 130, objectFit: 'cover' }}
                />
              )}
            </div>
          )}

          <div className="grid grid-cols-1 gap-3">
            {FIELD_KEYS.map(k => {
              const conf = scan.field_confidence[k]
              const isLow =
                typeof conf === 'number' && conf < 0.85
              const isMissing = !(k in scan.parsed_fields)
              if (isMissing && !edited[k]) {
                // Still render — therapist can fill in manually.
              }
              return (
                <div key={k}>
                  <label className="text-xs text-gray-500 uppercase tracking-wide flex items-center gap-2">
                    {FIELD_LABELS[k]}
                    {isLow && (
                      <span className="text-[10px] normal-case text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">
                        Please verify
                      </span>
                    )}
                    {typeof conf === 'number' && !isLow && (
                      <span className="text-[10px] normal-case text-green-700">
                        {Math.round(conf * 100)}%
                      </span>
                    )}
                  </label>
                  <input
                    value={edited[k] ?? ''}
                    onChange={e => setField(k, e.target.value)}
                    className={
                      'w-full border rounded-lg px-3 py-2 text-sm ' +
                      (isLow
                        ? 'border-amber-400 bg-amber-50'
                        : 'border-gray-200 bg-white')
                    }
                    style={{ minHeight: 44 }}
                    placeholder={isMissing ? 'Not detected — type to add' : ''}
                  />
                </div>
              )
            })}
          </div>

          {errMsg && (
            <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{errMsg}</span>
            </div>
          )}

          {stage === 'saved' ? (
            <div className="flex items-center gap-2 text-sm text-green-700">
              <CheckCircle2 className="w-4 h-4" />
              Saved to patient record.
            </div>
          ) : (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={save}
                disabled={stage === 'saving'}
                className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white font-medium rounded-lg px-4 py-3"
                style={{ minHeight: 44 }}
              >
                {stage === 'saving' ? 'Saving…' : 'Save to patient'}
              </button>
              <button
                type="button"
                onClick={reset}
                className="text-gray-700 hover:bg-gray-100 rounded-lg px-4 py-3 flex items-center gap-1"
                style={{ minHeight: 44 }}
              >
                <RefreshCw className="w-4 h-4" />
                Re-scan
              </button>
            </div>
          )}
        </div>
      )}

      {/* Tap-to-expand image overlay */}
      {zoomed && (
        <div
          className="fixed inset-0 bg-black/85 flex items-center justify-center z-50 p-4"
          onClick={() => setZoomed(null)}
          role="dialog"
          aria-label="Card preview"
        >
          <img src={zoomed} alt="Card preview" className="max-w-full max-h-full rounded-lg" />
        </div>
      )}
    </div>
  )
}

function CardSidePicker({
  label,
  preview,
  onPick,
  onClear,
  onZoom,
}: {
  label: string
  preview: string | null
  onPick: (f: File | null) => void
  onClear: () => void
  onZoom: () => void
}) {
  const inputId = `insurance-card-${label.replace(/\W+/g, '-')}`
  return (
    <div>
      <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">{label}</div>
      {preview ? (
        <div className="flex items-center gap-3">
          <img
            src={preview}
            alt={`Card ${label}`}
            onClick={onZoom}
            className="rounded-lg border border-gray-200 cursor-zoom-in"
            style={{ maxWidth: 200, maxHeight: 130, objectFit: 'cover' }}
          />
          <button
            type="button"
            onClick={onClear}
            className="text-sm text-gray-700 hover:bg-gray-100 rounded-lg px-3 py-2"
            style={{ minHeight: 44 }}
          >
            Replace
          </button>
        </div>
      ) : (
        <label
          htmlFor={inputId}
          className="flex items-center justify-center gap-2 border-2 border-dashed border-gray-300 rounded-lg p-4 text-gray-700 hover:bg-gray-50 cursor-pointer"
          style={{ minHeight: 88 }}
        >
          <Camera className="w-5 h-5" />
          <span className="font-medium">Capture {label.toLowerCase()}</span>
        </label>
      )}
      <input
        id={inputId}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={e => onPick(e.target.files?.[0] ?? null)}
      />
    </div>
  )
}

export default InsuranceCardScanner
