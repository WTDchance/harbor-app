// app/dashboard/patients/[id]/documents/page.tsx
//
// W43 T2 — patient documents tab. Therapist can upload, browse, and
// download documents associated with the patient chart. 10 MB cap
// enforced server-side; UI surfaces errors when files are too big or
// the wrong type.

'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

type Doc = {
  id: string
  original_filename: string
  content_type: string
  size_bytes: number
  category: string
  description: string | null
  uploaded_by_patient: boolean
  uploaded_at: string
}

const CATEGORIES = [
  'court_order',
  'prior_treatment_record',
  'iep',
  'insurance_doc',
  'consent_scan',
  'other',
]

const ALLOWED_MIME = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/heif',
  'image/webp',
  'image/tiff',
  'text/plain',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export default function PatientDocumentsPage() {
  const params = useParams<{ id: string }>()
  const patientId = params?.id as string

  const [docs, setDocs] = useState<Doc[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [category, setCategory] = useState('other')
  const [description, setDescription] = useState('')
  const [uploading, setUploading] = useState(false)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/ehr/patients/${patientId}/documents`)
      if (!res.ok) throw new Error('Failed to load')
      const j = await res.json()
      setDocs(j.documents || [])
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { if (patientId) void load() }, [patientId])

  async function upload(e: React.FormEvent) {
    e.preventDefault()
    if (!file) return
    setUploading(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('category', category)
      if (description) form.append('description', description)

      const res = await fetch(`/api/ehr/patients/${patientId}/documents`, {
        method: 'POST',
        body: form,
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || `Upload failed (${res.status})`)
      }
      setFile(null)
      setDescription('')
      setCategory('other')
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setUploading(false)
    }
  }

  async function download(id: string) {
    try {
      const res = await fetch(`/api/ehr/patients/${patientId}/documents/${id}?action=download`)
      if (!res.ok) throw new Error('Failed to mint download URL')
      const j = await res.json()
      window.open(j.url, '_blank')
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function remove(id: string) {
    if (!confirm('Delete this document? It will be removed from the patient chart.')) return
    try {
      const res = await fetch(`/api/ehr/patients/${patientId}/documents/${id}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error('Delete failed')
      await load()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Patient documents</h1>
        <p className="text-sm text-gray-600 mt-1">
          Upload prior treatment records, court orders, IEPs, scanned
          consents, or any other document that belongs in the chart but
          isn't part of a structured form. Files are encrypted at rest
          and retained for 7 years.
        </p>
      </div>

      <form onSubmit={upload} className="rounded border bg-white p-4 space-y-3">
        <input
          type="file"
          accept={ALLOWED_MIME.join(',')}
          onChange={(e) => setFile(e.target.files?.[0] || null)}
          className="block w-full text-sm"
        />
        <div className="grid grid-cols-2 gap-2">
          <label className="text-sm">
            Category
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="block w-full border rounded px-2 py-1 mt-1"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Description (optional)
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="block w-full border rounded px-2 py-1 mt-1"
            />
          </label>
        </div>
        <button
          type="submit"
          disabled={!file || uploading}
          className="bg-[#1f375d] text-white px-3 py-1.5 rounded text-sm disabled:opacity-50"
        >
          {uploading ? 'Uploading…' : 'Upload'}
        </button>
        <p className="text-xs text-gray-500">
          Max 10 MB. PDFs, images, Word docs, plain text.
        </p>
      </form>

      {error && (
        <div className="rounded bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : docs.length === 0 ? (
        <p className="text-sm text-gray-500">No documents yet.</p>
      ) : (
        <ul className="border rounded divide-y bg-white">
          {docs.map((d) => (
            <li key={d.id} className="px-3 py-2.5 flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="font-medium text-sm truncate">{d.original_filename}</div>
                <div className="text-xs text-gray-500">
                  {d.category.replace(/_/g, ' ')} · {fmtBytes(d.size_bytes)} ·{' '}
                  {new Date(d.uploaded_at).toLocaleDateString()}
                  {d.uploaded_by_patient && ' · uploaded by patient'}
                </div>
                {d.description && (
                  <div className="text-xs text-gray-600 mt-1">{d.description}</div>
                )}
              </div>
              <div className="flex items-center gap-2 text-sm">
                <button
                  onClick={() => download(d.id)}
                  className="text-[#1f375d] hover:underline"
                >
                  Download
                </button>
                <button
                  onClick={() => remove(d.id)}
                  className="text-red-600 hover:underline"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
