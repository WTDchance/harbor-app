// components/ehr/ExportPatientButton.tsx
// Patient-profile button: opens the full record as a printable HTML page
// in a new tab (therapist or patient can Print → Save as PDF). Optional
// JSON download for data portability.

'use client'

import { useState } from 'react'
import { Download, FileJson, FileText, Share2 } from 'lucide-react'

export function ExportPatientButton({ patientId }: { patientId: string }) {
  const [open, setOpen] = useState(false)

  return (
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
          </div>
        </>
      )}
    </div>
  )
}
