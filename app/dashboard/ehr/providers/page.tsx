'use client'

// Wave 40 / P3 — practice-scoped external provider directory.
// Catalogue list + create modal. Patient-link UX lives on the
// patient detail page (small follow-up; APIs already in place).

import { useEffect, useState } from 'react'
import { Plus, X, Phone, Mail, MapPin, Stethoscope, Briefcase, GraduationCap, Users } from 'lucide-react'

type Role = 'pcp' | 'psychiatrist' | 'school' | 'attorney' | 'other'

interface Provider {
  id: string
  name: string
  npi: string | null
  role: Role
  organization: string | null
  phone: string | null
  fax: string | null
  email: string | null
  address: string | null
  notes: string | null
  deleted_at: string | null
}

const ROLES: Array<{ value: '' | Role; label: string }> = [
  { value: '', label: 'All' },
  { value: 'pcp', label: 'PCPs' },
  { value: 'psychiatrist', label: 'Psychiatrists' },
  { value: 'school', label: 'Schools' },
  { value: 'attorney', label: 'Attorneys' },
  { value: 'other', label: 'Other' },
]

const ROLE_ICONS: Record<Role, any> = {
  pcp: Stethoscope,
  psychiatrist: Stethoscope,
  school: GraduationCap,
  attorney: Briefcase,
  other: Users,
}

export default function ProvidersPage() {
  const [rows, setRows] = useState<Provider[]>([])
  const [loading, setLoading] = useState(true)
  const [roleFilter, setRoleFilter] = useState<'' | Role>('')
  const [showForm, setShowForm] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Form state.
  const [name, setName] = useState('')
  const [npi, setNpi] = useState('')
  const [role, setRole] = useState<Role>('pcp')
  const [organization, setOrganization] = useState('')
  const [phone, setPhone] = useState('')
  const [fax, setFax] = useState('')
  const [email, setEmail] = useState('')
  const [address, setAddress] = useState('')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const qs = roleFilter ? `?role=${encodeURIComponent(roleFilter)}` : ''
      const res = await fetch(`/api/ehr/external-providers${qs}`, { credentials: 'include' })
      if (!res.ok) { setRows([]); return }
      const data = await res.json()
      setRows(Array.isArray(data?.providers) ? data.providers : [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [roleFilter])

  function resetForm() {
    setName(''); setNpi(''); setRole('pcp'); setOrganization('')
    setPhone(''); setFax(''); setEmail(''); setAddress(''); setNotes('')
    setError(null)
  }

  async function submit() {
    setSubmitting(true)
    setError(null)
    try {
      const body: Record<string, unknown> = { name, role }
      if (npi) body.npi = npi
      if (organization) body.organization = organization
      if (phone) body.phone = phone
      if (fax) body.fax = fax
      if (email) body.email = email
      if (address) body.address = address
      if (notes) body.notes = notes
      const res = await fetch('/api/ehr/external-providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setError(data?.error?.message || `Create failed (${res.status})`)
        return
      }
      setShowForm(false)
      resetForm()
      await load()
    } catch (err: any) {
      setError(err?.message || 'Network error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="flex-1 p-6 max-w-5xl mx-auto w-full">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">External providers</h1>
          <p className="text-sm text-gray-500 mt-0.5">PCPs, psychiatrists, schools, attorneys — outside contacts your practice coordinates with.</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700"
          style={{ minHeight: 44 }}
        >
          <Plus className="w-4 h-4" />
          New provider
        </button>
      </div>

      <div className="flex items-center gap-2 mb-4 overflow-x-auto -mx-2 px-2">
        {ROLES.map((r) => (
          <button
            key={r.value}
            onClick={() => setRoleFilter(r.value)}
            className={`shrink-0 px-3 py-1.5 text-xs font-medium rounded-full border ${
              roleFilter === r.value
                ? 'bg-teal-600 text-white border-teal-600'
                : 'bg-white text-gray-700 border-gray-200 hover:border-gray-300'
            }`}
            style={{ minHeight: 32 }}
          >
            {r.label}
          </button>
        ))}
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
      ) : rows.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-500">
          No providers in your directory yet. Tap "New provider" to add one.
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((p) => (
            <li key={p.id} className="bg-white rounded-xl border border-gray-200 p-4">
              <ProviderCard p={p} />
            </li>
          ))}
        </ul>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-gray-900">New external provider</h2>
              <button
                onClick={() => { setShowForm(false); resetForm() }}
                className="text-gray-400 hover:text-gray-600"
                style={{ minHeight: 44, minWidth: 44 }}
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-3">
              <Field label="Name" required>
                <input value={name} onChange={(e) => setName(e.target.value)}
                       className="w-full p-2 text-sm border border-gray-200 rounded-lg" style={{ minHeight: 44 }} />
              </Field>
              <Field label="Role" required>
                <select value={role} onChange={(e) => setRole(e.target.value as Role)}
                        className="w-full p-2 text-sm border border-gray-200 rounded-lg" style={{ minHeight: 44 }}>
                  <option value="pcp">PCP / primary care</option>
                  <option value="psychiatrist">Psychiatrist</option>
                  <option value="school">School</option>
                  <option value="attorney">Attorney</option>
                  <option value="other">Other</option>
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="NPI">
                  <input value={npi} onChange={(e) => setNpi(e.target.value)}
                         className="w-full p-2 text-sm border border-gray-200 rounded-lg" style={{ minHeight: 44 }} />
                </Field>
                <Field label="Organization">
                  <input value={organization} onChange={(e) => setOrganization(e.target.value)}
                         className="w-full p-2 text-sm border border-gray-200 rounded-lg" style={{ minHeight: 44 }} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Phone">
                  <input value={phone} onChange={(e) => setPhone(e.target.value)}
                         className="w-full p-2 text-sm border border-gray-200 rounded-lg" style={{ minHeight: 44 }} />
                </Field>
                <Field label="Fax">
                  <input value={fax} onChange={(e) => setFax(e.target.value)}
                         className="w-full p-2 text-sm border border-gray-200 rounded-lg" style={{ minHeight: 44 }} />
                </Field>
              </div>
              <Field label="Email">
                <input value={email} onChange={(e) => setEmail(e.target.value)}
                       className="w-full p-2 text-sm border border-gray-200 rounded-lg" style={{ minHeight: 44 }} />
              </Field>
              <Field label="Address">
                <input value={address} onChange={(e) => setAddress(e.target.value)}
                       className="w-full p-2 text-sm border border-gray-200 rounded-lg" style={{ minHeight: 44 }} />
              </Field>
              <Field label="Notes">
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
                          rows={2}
                          className="w-full p-2 text-sm border border-gray-200 rounded-lg" />
              </Field>
            </div>
            <div className="flex items-center justify-end gap-2 mt-4">
              <button onClick={() => { setShowForm(false); resetForm() }}
                      className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg"
                      style={{ minHeight: 44 }}>Cancel</button>
              <button onClick={submit} disabled={submitting || !name}
                      className="px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 disabled:opacity-60"
                      style={{ minHeight: 44 }}>
                {submitting ? 'Creating…' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

function ProviderCard({ p }: { p: Provider }) {
  const Icon = ROLE_ICONS[p.role] ?? Users
  return (
    <div className="flex items-start gap-3">
      <div className="shrink-0 w-9 h-9 rounded-full bg-teal-50 text-teal-700 flex items-center justify-center">
        <Icon className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <div>
            <span className="text-sm font-semibold text-gray-900">{p.name}</span>
            {p.organization && <span className="text-sm text-gray-500"> · {p.organization}</span>}
          </div>
          <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 capitalize">{p.role}</span>
        </div>
        {p.npi && <p className="text-xs text-gray-500 mt-0.5">NPI: <code className="bg-gray-50 px-1 py-0.5 rounded">{p.npi}</code></p>}
        <div className="flex items-center gap-3 flex-wrap mt-1.5 text-xs text-gray-600">
          {p.phone && <span className="inline-flex items-center gap-1"><Phone className="w-3 h-3" />{p.phone}</span>}
          {p.fax   && <span className="inline-flex items-center gap-1">Fax: {p.fax}</span>}
          {p.email && <span className="inline-flex items-center gap-1"><Mail  className="w-3 h-3" />{p.email}</span>}
          {p.address && <span className="inline-flex items-center gap-1"><MapPin className="w-3 h-3" />{p.address}</span>}
        </div>
        {p.notes && <p className="text-xs text-gray-500 mt-2 whitespace-pre-line">{p.notes}</p>}
      </div>
    </div>
  )
}

function Field({ label, required, children }: { label: string; required?: boolean; children: any }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-700 mb-1">
        {label}{required && <span className="text-red-600 ml-1">*</span>}
      </label>
      {children}
    </div>
  )
}
