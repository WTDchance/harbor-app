'use client'

// Wave 21: supabase-browser is now a no-op stub (returns empty arrays).
// Pages still call supabase.from() against it; full rewrite to AWS API
// fetches lands in Wave 23. Auth redirects are gone — pages render empty.
import { createClient } from '@/lib/supabase-browser'
const supabase = createClient()

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ExternalLink, Phone, Mail, Eye, Power, X } from 'lucide-react'

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
  // Wave 39 — decommission fields. Optional because older API responses
  // may not include them; we treat absence as "still active".
  provisioning_state?: string | null
  decommissioned_at?: string | null
  stripe_subscription_id?: string | null
}

export default function AdminPractices() {
  const [practices, setPractices] = useState<Practice[]>([])
  const [loading, setLoading] = useState(true)
  const [viewingId, setViewingId] = useState<string | null>(null)
  // Wave 39 — decommission modal state.
  const [decommissionTarget, setDecommissionTarget] = useState<Practice | null>(null)
  const [confirmText, setConfirmText] = useState('')
  const [decommissioning, setDecommissioning] = useState(false)
  const [decommissionResult, setDecommissionResult] =
    useState<{ practiceId: string; sideEffects: Record<string, { ok: boolean; detail?: string }> } | null>(null)

  async function decommission(practice: Practice) {
    setDecommissioning(true)
    setDecommissionResult(null)
    try {
      const res = await fetch(`/api/admin/practices/${practice.id}/decommission`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ practice_id: practice.id }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        const friendly =
          (data?.error && typeof data.error === 'object' && data.error.message) ||
          (typeof data?.error === 'string' ? data.error : null) ||
          `Decommission failed (${res.status})`
        alert(friendly)
        return
      }
      setDecommissionResult({
        practiceId: practice.id,
        sideEffects: data?.side_effects ?? {},
      })
      // Refresh the list so the row reflects the new status.
      const listRes = await fetch('/api/admin/signups', { credentials: 'include' })
      if (listRes.ok) {
        const j = await listRes.json()
        setPractices(j.practices || [])
      }
    } catch (err: any) {
      alert(err?.message || 'Decommission request failed')
    } finally {
      setDecommissioning(false)
    }
  }

  function closeModal() {
    setDecommissionTarget(null)
    setConfirmText('')
    setDecommissionResult(null)
    setDecommissioning(false)
  }

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
                    {p.provisioning_state === 'cancelled' && (
                      <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-200 text-gray-700">
                        Decommissioned
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
                      {p.provisioning_state !== 'cancelled' && (
                        <button
                          onClick={() => setDecommissionTarget(p)}
                          className="flex items-center gap-1 text-red-600 hover:text-red-700 text-sm font-medium"
                          title="Gracefully decommission this practice — releases SignalWire number, cancels Stripe sub, deactivates users. Does NOT delete PHI."
                          style={{ minHeight: 44 }}
                        >
                          <Power className="w-4 h-4" />
                          Decommission
                        </button>
                      )}
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

      {decommissionTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => !decommissioning && closeModal()}
        >
          <div
            className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-3">
              <h2 className="text-lg font-semibold text-gray-900">
                Decommission practice
              </h2>
              <button
                onClick={() => !decommissioning && closeModal()}
                className="text-gray-400 hover:text-gray-600"
                aria-label="Close"
                style={{ minHeight: 44, minWidth: 44 }}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {!decommissionResult ? (
              <>
                <p className="text-sm text-gray-600 mb-4">
                  This will gracefully retire <strong>{decommissionTarget.name}</strong>:
                </p>
                <ul className="text-sm text-gray-600 list-disc pl-5 mb-4 space-y-1">
                  <li>Mark the practice as <em>cancelled</em> (status flip)</li>
                  <li>Release the SignalWire number back to the pool</li>
                  <li>Pause the Retell agent</li>
                  <li>Deactivate every user on the practice</li>
                  <li>Cancel the active Stripe subscription</li>
                  <li>Write an entry to <code>audit_logs</code></li>
                </ul>
                <p className="text-sm text-gray-600 mb-4">
                  Patient records, appointments, notes, and audit logs are <strong>not deleted</strong> —
                  the practice owner can request an export later.
                </p>
                {decommissionTarget.stripe_subscription_id && (
                  <div className="mb-4 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
                    <strong>Active Stripe subscription will be cancelled immediately.</strong>{' '}
                    No prorated refund will be issued.
                  </div>
                )}
                <p className="text-sm text-gray-600 mb-2">
                  To enable the Decommission button, type the practice name below verbatim:
                </p>
                <p className="text-xs text-gray-500 mb-2">
                  <code className="bg-gray-100 px-1.5 py-0.5 rounded">{decommissionTarget.name}</code>
                </p>
                <input
                  type="text"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder="Type practice name to confirm"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                  autoFocus
                  disabled={decommissioning}
                  style={{ minHeight: 44 }}
                />
                <div className="flex items-center justify-end gap-2 mt-5">
                  <button
                    onClick={closeModal}
                    disabled={decommissioning}
                    className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg disabled:opacity-60"
                    style={{ minHeight: 44 }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => decommission(decommissionTarget)}
                    disabled={decommissioning || confirmText !== decommissionTarget.name}
                    className="flex items-center gap-1 px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:bg-red-300 disabled:cursor-not-allowed"
                    style={{ minHeight: 44 }}
                  >
                    <Power className="w-4 h-4" />
                    {decommissioning ? 'Decommissioning…' : 'Decommission'}
                  </button>
                </div>
              </>
            ) : (
              <div>
                <p className="text-sm text-gray-700 mb-3">
                  Practice marked as cancelled. Side effects:
                </p>
                <ul className="text-sm space-y-1.5 mb-4">
                  {(Object.entries(decommissionResult.sideEffects) as Array<
                    [string, { ok: boolean; detail?: string }]
                  >).map(([key, val]) => (
                    <li key={key} className="flex items-start gap-2">
                      <span className={val.ok ? 'text-green-600' : 'text-amber-600'}>
                        {val.ok ? '✓' : '!'}
                      </span>
                      <span>
                        <strong className="text-gray-900">{key.replace(/_/g, ' ')}</strong>
                        {val.detail && (
                          <span className="text-gray-500"> — {val.detail}</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="flex justify-end">
                  <button
                    onClick={closeModal}
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
    </div>
  )
}
