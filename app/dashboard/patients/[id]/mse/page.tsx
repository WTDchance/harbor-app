'use client'

// Wave 39 / Task 1 — Mental Status Exam list page.
//
// Lists every MSE for a patient. New-exam button creates a draft and
// navigates straight into the editor.

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Plus, FileText, Check, Clock } from 'lucide-react'

interface MseRow {
  id: string
  patient_id: string
  appointment_id: string | null
  administered_by: string
  administered_at: string
  status: 'draft' | 'completed' | 'amended'
  completed_at: string | null
  summary: string | null
}

export default function MsePage() {
  const params = useParams()
  const router = useRouter()
  const patientId = String(params.id)

  const [exams, setExams] = useState<MseRow[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/ehr/patients/${patientId}/mse`, { credentials: 'include' })
      if (!res.ok) {
        setExams([])
        setError(`Could not load exams (${res.status})`)
        return
      }
      const data = await res.json()
      setExams(Array.isArray(data?.exams) ? data.exams : [])
    } catch (err: any) {
      setError(err?.message || 'Network error')
      setExams([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [patientId])

  async function createDraft() {
    setCreating(true)
    setError(null)
    try {
      const res = await fetch(`/api/ehr/patients/${patientId}/mse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setError(data?.error?.message || `Create failed (${res.status})`)
        return
      }
      const { exam } = await res.json()
      router.push(`/dashboard/patients/${patientId}/mse/${exam.id}`)
    } catch (err: any) {
      setError(err?.message || 'Network error')
    } finally {
      setCreating(false)
    }
  }

  return (
    <main className="flex-1 p-6 max-w-3xl mx-auto w-full">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Mental Status Exams</h1>
          <p className="text-sm text-gray-500 mt-0.5">All MSEs administered to this patient.</p>
        </div>
        <button
          onClick={createDraft}
          disabled={creating}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 disabled:opacity-60"
          style={{ minHeight: 44 }}
        >
          <Plus className="w-4 h-4" />
          {creating ? 'Creating…' : 'New MSE'}
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-32">
          <div className="w-6 h-6 border-2 border-teal-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : exams.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-500">
          <FileText className="w-10 h-10 mx-auto text-gray-300 mb-3" />
          <p>No MSEs administered yet.</p>
          <p className="text-xs mt-1">Tap New MSE to start one.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {exams.map((e) => (
            <li key={e.id}>
              <Link
                href={`/dashboard/patients/${patientId}/mse/${e.id}`}
                className="block bg-white rounded-xl border border-gray-200 p-4 hover:border-teal-300 hover:shadow-sm transition"
                style={{ minHeight: 72 }}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-sm font-semibold text-gray-900">
                      {new Date(e.administered_at).toLocaleString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </div>
                    {e.summary ? (
                      <p className="text-sm text-gray-600 mt-1 line-clamp-2">{e.summary}</p>
                    ) : (
                      <p className="text-xs text-gray-400 italic mt-1">No clinical summary yet</p>
                    )}
                  </div>
                  <StatusPill status={e.status} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}

function StatusPill({ status }: { status: MseRow['status'] }) {
  if (status === 'completed') {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
        <Check className="w-3 h-3" />
        Completed
      </span>
    )
  }
  if (status === 'amended') {
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
        Amended
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
      <Clock className="w-3 h-3" />
      Draft
    </span>
  )
}
