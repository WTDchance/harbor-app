'use client'

// Wave 21: supabase-browser is now a no-op stub (returns empty arrays).
// Pages still call supabase.from() against it; full rewrite to AWS API
// fetches lands in Wave 23. Auth redirects are gone — pages render empty.
import { createClient } from '@/lib/supabase-browser'
const supabase = createClient()

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ExternalLink, Phone, Mail, Eye } from 'lucide-react'

interface Practice {
  id: string
  name: string
  therapist_name: string
  notification_email: string
  phone_number: string | null
  vapi_assistant_id: string | null
  telehealth: boolean
  specialties: string[]
  created_at: string
}

export default function AdminPractices() {
  const [practices, setPractices] = useState<Practice[]>([])
  const [loading, setLoading] = useState(true)
  const [viewingId, setViewingId] = useState<string | null>(null)

  async function actAs(practiceId: string) {
    setViewingId(practiceId)
    // Wave 21: Cognito session cookie auto-attached on same-origin fetch — no Bearer needed
    const res = await fetch('/api/admin/act-as', {
      method: 'POST',
      headers: {
                'Content-Type': 'application/json',
      },
      body: JSON.stringify({ practiceId }),
    })
    if (!res.ok) {
      alert('Failed to enter admin view')
      setViewingId(null)
      return
    }
    window.location.href = '/dashboard'
  }

  useEffect(() => {
    // Use the admin signups API instead of the browser Supabase client so we
    // bypass RLS and see every practice (including Harbor Demo and anything
    // not tied to the admin's auth user).
    ;(async () => {
      try {
        const res = await fetch('/api/admin/signups', { credentials: 'include' })
        if (!res.ok) {
          setPractices([])
        } else {
          const json = await res.json()
          setPractices(json.practices || [])
        }
      } catch {
        setPractices([])
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">All Practices</h1>
        <Link href="/admin/provision"
          className="bg-teal-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-teal-700">
          + Add Therapist
        </Link>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <div className="w-6 h-6 border-2 border-teal-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="-mx-4 md:mx-0 overflow-x-auto">
            <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left text-xs font-medium text-gray-500 uppercase px-5 py-3">Practice</th>
                <th className="text-left text-xs font-medium text-gray-500 uppercase px-5 py-3">Contact</th>
                <th className="text-left text-xs font-medium text-gray-500 uppercase px-5 py-3">Vapi</th>
                <th className="text-left text-xs font-medium text-gray-500 uppercase px-5 py-3">Status</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {practices.map(p => (
                <tr key={p.id} className="hover:bg-gray-50">
                  <td className="px-5 py-4">
                    <p className="font-medium text-gray-900">{p.name}</p>
                    <p className="text-sm text-gray-500">{p.therapist_name}</p>
                    {p.specialties?.length > 0 && (
                      <p className="text-xs text-gray-400 mt-0.5">{p.specialties.slice(0, 2).join(', ')}</p>
                    )}
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-1.5 text-sm text-gray-500">
                        <Mail className="w-3.5 h-3.5" />
                        {p.notification_email}
                      </div>
                      {p.phone_number && (
                        <div className="flex items-center gap-1.5 text-sm text-gray-500">
                          <Phone className="w-3.5 h-3.5" />
                          {p.phone_number}
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    {p.vapi_assistant_id ? (
                      <code className="text-xs bg-gray-100 px-2 py-0.5 rounded text-gray-600">
                        {p.vapi_assistant_id.slice(0, 8)}...
                      </code>
                    ) : (
                      <span className="text-xs text-gray-400">Not set</span>
                    )}
                  </td>
                  <td className="px-5 py-4">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      p.vapi_assistant_id && p.phone_number
                        ? 'bg-green-100 text-green-700'
                        : p.vapi_assistant_id
                        ? 'bg-yellow-100 text-yellow-700'
                        : 'bg-gray-100 text-gray-600'
                    }`}>
                      {p.vapi_assistant_id && p.phone_number ? 'Fully Live' : p.vapi_assistant_id ? 'Needs Phone #' : 'Setup Needed'}
                    </span>
                    {p.telehealth && (
                      <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-600">
                        Telehealth
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-4 text-right">
                    <div className="flex items-center gap-3 justify-end">
                      <button
                        onClick={() => actAs(p.id)}
                        disabled={viewingId === p.id}
                        className="flex items-center gap-1 text-amber-600 hover:text-amber-700 text-sm font-medium disabled:opacity-60"
                        title="Open this practice's dashboard as admin"
                      >
                        <Eye className="w-4 h-4" />
                        {viewingId === p.id ? 'Opening…' : 'View dashboard'}
                      </button>
                      <Link href={`/admin/practices/${p.id}`}
                        className="flex items-center gap-1 text-teal-600 hover:text-teal-700 text-sm font-medium">
                        Manage <ExternalLink className="w-3 h-3" />
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
              {practices.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-12 text-center text-gray-400">
                    No practices yet. <Link href="/admin/provision" className="text-teal-600 hover:underline">Add one.</Link>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  )
}
