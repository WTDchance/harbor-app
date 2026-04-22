// app/dashboard/ehr/notes/[id]/AmendButton.tsx
// Create an amendment to a signed note. The API creates a new draft
// row with the original content copied in; we redirect to the new draft.

'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { FilePlus2 } from 'lucide-react'

export function AmendButton({ noteId }: { noteId: string }) {
  const router = useRouter()
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleAmend() {
    if (!confirm('Start an amendment? The original signed note stays intact. You\'ll edit and sign the amendment as a new entry.')) return
    setWorking(true)
    setError(null)
    try {
      const res = await fetch(`/api/ehr/notes/${noteId}/amend`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Amendment failed')
      router.push(`/dashboard/ehr/notes/${json.note.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Amendment failed')
      setWorking(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleAmend}
        disabled={working}
        className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-teal-600 text-teal-700 text-sm font-medium rounded-lg hover:bg-teal-50 disabled:opacity-50"
      >
        <FilePlus2 className="w-4 h-4" />
        {working ? 'Creating amendment…' : 'Amend this note'}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  )
}
