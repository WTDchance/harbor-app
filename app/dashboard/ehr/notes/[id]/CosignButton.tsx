// Supervisor co-sign button — shown on signed notes that require cosign.
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { PenLine as Signature } from 'lucide-react'

export function CosignButton({ noteId }: { noteId: string }) {
  const router = useRouter()
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleCosign() {
    if (!confirm('Co-sign this note? This records your signature on the supervisee\'s work.')) return
    setWorking(true); setError(null)
    try {
      const res = await fetch(`/api/ehr/notes/${noteId}/cosign`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Co-sign failed')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Co-sign failed')
      setWorking(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleCosign}
        disabled={working}
        className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg disabled:opacity-50"
      >
        <Signature className="w-4 h-4" />
        {working ? 'Co-signing…' : 'Co-sign as supervisor'}
      </button>
      {error && <span className="text-xs text-red-600 max-w-[220px] text-right">{error}</span>}
    </div>
  )
}
