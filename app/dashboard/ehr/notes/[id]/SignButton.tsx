// app/dashboard/ehr/notes/[id]/SignButton.tsx
// Small client component for the "Sign" action. Confirms before posting.

'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2 } from 'lucide-react'

export function SignButton({ noteId }: { noteId: string }) {
  const router = useRouter()
  const [signing, setSigning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSign() {
    if (!confirm('Sign this note? Signed notes are immutable — further changes require an amendment.')) return
    setSigning(true)
    setError(null)
    try {
      const res = await fetch(`/api/ehr/notes/${noteId}/sign`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Sign failed')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign failed')
    } finally {
      setSigning(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleSign}
        disabled={signing}
        className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-lg disabled:opacity-50"
      >
        <CheckCircle2 className="w-4 h-4" />
        {signing ? 'Signing…' : 'Sign note'}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  )
}
