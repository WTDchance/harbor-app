// components/ehr/ExportPatientButton.tsx
// Patient-profile button: opens the full record as a printable HTML page
// in a new tab (therapist or patient can Print → Save as PDF). Optional
// JSON download for data portability.

'use client'

import { useState } from 'react'
import { Download, FileJson, FileText, Share2, ShieldCheck, X } from 'lucide-react'

export function ExportPatientButton({ patientId }: { patientId: string }) {
  const [open, setOpen] = useState(false)
  // Wave 39 — full PHI export modal state.
  const [phiOpen, setPhiOpen] = useState(false)
  const [phiBusy, setPhiBusy] = useState(false)
  const [phiResult, setPhiResult] =
    useState<{ url: string; expires_at: string; export_id: string } | null>(null)
  const [phiError, setPhiError] = useState<string | null>(null)

  async function startPhiExport() {
    setPhiBusy(true); setPhiError(null); setPhiResult(null)
    try {
      const res = await fetch(`/api/ehr/patients/${patientId}/export-phi`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setPhiError(
          (data?.error && typeof data.error === 'object' ? data.error.message : data?.error) ||
            `Export failed (${res.status})`,
        )
        return
      }
      setPhiResult(data)
    } catch (err: any) {
      setPhiError(err?.message || 'Export request failed')
    } finally {
      setPhiBusy(false)
    }
  }

  function closePhi() {
    setPhiOpen(false); setPhiBusy(false); setPhiResult(null); setPhiError(null)
  }


  return (
    <>
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 text-xs bg-white border border-gray-300 text-gray-700 px-2.5 py-1.5 rounded-md hover:bg-gray-50"
      >
        <Download className="w-3.5 h-3.5" />
        Export record
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-20 w-56 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
            <a
              href={`/api/ehr/patients/${patientId}/export?format=html`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
              onClick={() => setOpen(false)}
            >
              <FileText className="w-4 h-4 text-gray-500" />
              <div>
                <div className="font-medium">Printable record</div>
                <div className="text-[10px] text-gray-500">HTML · print to save PDF</div>
              </div>
            </a>
            <a
              href={`/api/ehr/patients/${patientId}/continuity-summary`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 border-t border-gray-100"
              onClick={() => setOpen(false)}
            >
              <Share2 className="w-4 h-4 text-gray-500" />
              <div>
                <div className="font-medium">Continuity of Care summary</div>
                <div className="text-[10px] text-gray-500">one-page referral · send to PCP / psychiatrist</div>
              </div>
            </a>
            <a
              href={`/api/ehr/patients/${patientId}/export?format=json`}
              className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 border-t border-gray-100"
              onClick={() => setOpen(false)}
            >
              <FileJson className="w-4 h-4 text-gray-500" />
              <div>
                <div className="font-medium">Full data (JSON)</div>
                <div className="text-[10px] text-gray-500">machine-readable export</div>
              </div>
            </a>
            <div className="border-t border-gray-100 px-3 py-1.5 text-[10px] uppercase tracking-wide text-gray-400">
              Records / Privacy
            </div>
            <button
              type="button"
              onClick={() => { setOpen(false); setPhiOpen(true) }}
              className="w-full text-left flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              <ShieldCheck className="w-4 h-4 text-indigo-600" />
              <div>
                <div className="font-medium">Export patient data</div>
                <div className="text-[10px] text-gray-500">complete ZIP · 24h signed link</div>
              </div>
            </button>
          </div>
        </>
      )}
    </div>
      {phiOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => !phiBusy && closePhi()}
        >
          <div
            className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-3">
              <h2 className="text-lg font-semibold text-gray-900">Export patient data</h2>
              <button
                onClick={() => !phiBusy && closePhi()}
                className="text-gray-400 hover:text-gray-600"
                aria-label="Close"
                style={{ minHeight: 44, minWidth: 44 }}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {!phiResult ? (
              <>
                <p className="text-sm text-gray-600 mb-4">
                  This generates a complete ZIP of this patient's clinical data. Downloads expire
                  after 24 hours. Continue?
                </p>
                <ul className="text-sm text-gray-600 list-disc pl-5 mb-4 space-y-1">
                  <li>Profile, demographics, appointments</li>
                  <li>Progress notes (JSON + printable PDF)</li>
                  <li>Treatment plans, assessments, safety plan</li>
                  <li>Consent signatures, audit log entries</li>
                </ul>
                {phiError && (
                  <div className="mb-4 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
                    {phiError}
                  </div>
                )}
                <div className="flex items-center justify-end gap-2 mt-5">
                  <button
                    onClick={closePhi}
                    disabled={phiBusy}
                    className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg disabled:opacity-60"
                    style={{ minHeight: 44 }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={startPhiExport}
                    disabled={phiBusy}
                    className="flex items-center gap-1 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:bg-indigo-300"
                    style={{ minHeight: 44 }}
                  >
                    <Download className="w-4 h-4" />
                    {phiBusy ? 'Generating…' : 'Continue'}
                  </button>
                </div>
              </>
            ) : (
              <div>
                <p className="text-sm text-gray-700 mb-3">
                  Export ready. The link below is valid until{' '}
                  <strong>{new Date(phiResult.expires_at).toLocaleString()}</strong>.
                </p>
                <div className="flex items-center gap-2 mb-4">
                  <input
                    readOnly
                    value={phiResult.url}
                    className="flex-1 px-2 py-1.5 border border-gray-300 rounded-md text-xs font-mono bg-gray-50"
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  <button
                    onClick={() => navigator.clipboard?.writeText(phiResult.url)}
                    className="px-3 py-1.5 text-xs font-medium text-white bg-gray-700 rounded-md hover:bg-gray-800"
                  >
                    Copy
                  </button>
                </div>
                <p className="text-[11px] text-gray-500 mb-4 break-all">
                  Export id: <code>{phiResult.export_id}</code>
                </p>
                <div className="flex justify-end gap-2">
                  <a
                    href={phiResult.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700"
                    style={{ minHeight: 44 }}
                  >
                    Download ZIP
                  </a>
                  <button
                    onClick={closePhi}
                    className="px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700"
                    style={{ minHeight: 44 }}
                  >
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
