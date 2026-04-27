'use client'

import { useState, useEffect, useCallback } from 'react'
import { Shield, Plus, RefreshCw, CheckCircle, XCircle, Clock, AlertCircle, ChevronDown, ChevronUp, X } from 'lucide-react'

const INSURANCE_COMPANIES = [
  'Aetna', 'Anthem', 'Anthem BCBS', 'Beacon Health Options',
  'Blue Cross Blue Shield', 'BCBS', 'Cigna', 'Humana',
  'Magellan Health', 'Medicaid', 'Medicare', 'Optum',
  'Tricare', 'United Healthcare', 'UnitedHealthcare', 'Value Options',
  'Other'
]

interface EligibilityCheck {
  id: string
  status: string
  is_active: boolean
  mental_health_covered: boolean
  copay_amount: number | null
  deductible_total: number | null
  deductible_met: number | null
  checked_at: string
  error_message: string | null
}

interface InsuranceRecord {
  id: string
  patient_name: string
  patient_dob: string | null
  patient_phone: string | null
  insurance_company: string
  member_id: string
  group_number: string | null
  subscriber_name: string | null
  relationship_to_subscriber: string
  created_at: string
  latest_check: EligibilityCheck | null
}

interface FormData {
  patient_name: string
  patient_dob: string
  patient_phone: string
  insurance_company: string
  member_id: string
  group_number: string
  subscriber_name: string
  subscriber_dob: string
  relationship: string
}

const emptyForm: FormData = {
  patient_name: '', patient_dob: '', patient_phone: '',
  insurance_company: '', member_id: '', group_number: '',
  subscriber_name: '', subscriber_dob: '', relationship: 'self'
}

function StatusBadge({ check }: { check: EligibilityCheck | null }) {
  if (!check) return <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-500 rounded-full">Not checked</span>
  if (check.status === 'manual_pending') return <span className="px-2 py-0.5 text-xs bg-yellow-100 text-yellow-700 rounded-full flex items-center gap-1 w-fit"><Clock className="w-3 h-3" />Manual</span>
  if (check.status === 'error') return <span className="px-2 py-0.5 text-xs bg-red-100 text-red-700 rounded-full flex items-center gap-1 w-fit"><XCircle className="w-3 h-3" />Error</span>
  if (check.is_active) return <span className="px-2 py-0.5 text-xs bg-green-100 text-green-700 rounded-full flex items-center gap-1 w-fit"><CheckCircle className="w-3 h-3" />Active</span>
  return <span className="px-2 py-0.5 text-xs bg-red-100 text-red-700 rounded-full flex items-center gap-1 w-fit"><XCircle className="w-3 h-3" />Inactive</span>
}

export default function InsurancePage() {
  const [records, setRecords] = useState<InsuranceRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<FormData>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [verifying, setVerifying] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [setupNeeded, setSetupNeeded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchRecords = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/insurance/records')
      const data = await res.json()
      setRecords(data.records || [])
      if (data.setup_needed) setSetupNeeded(true)
    } catch {
      setError('Failed to load insurance records')
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetchRecords() }, [fetchRecords])

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/insurance/records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Failed to save'); setSaving(false); return }
      setShowForm(false)
      setForm(emptyForm)
      await fetchRecords()
    } catch { setError('Network error') }
    setSaving(false)
  }

  async function handleVerify(record: InsuranceRecord) {
    setVerifying(record.id)
    setError(null)
    try {
      const res = await fetch('/api/insurance/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          record_id: record.id,
          patient_name: record.patient_name,
          patient_dob: record.patient_dob,
          insurance_company: record.insurance_company,
          member_id: record.member_id,
          subscriber_name: record.subscriber_name,
        })
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        // Wave 39 — read the structured `{ code, message, retryable }`
        // envelope; tolerate older shapes in case anything still returns a
        // plain string.
        const structured =
          data && typeof data === 'object' && data.error && typeof data.error === 'object'
            ? data.error
            : null
        const friendly =
          structured?.message ||
          (typeof data?.error_message === 'string' ? data.error_message : null) ||
          (typeof data?.error === 'string' ? data.error : null) ||
          `Verification failed (${res.status})`
        setError(friendly)
      }
      await fetchRecords()
    } catch { setError('Verification failed') }
    setVerifying(null)
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this insurance record?')) return
    await fetch(`/api/insurance/records?id=${id}`, { method: 'DELETE' })
    await fetchRecords()
  }

  const activeCount = records.filter(r => r.latest_check?.is_active).length
  const pendingCount = records.filter(r => !r.latest_check || r.latest_check.status === 'manual_pending').length

  return (
    <main className="flex-1 p-8 max-w-5xl mx-auto w-full">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Shield className="w-6 h-6 text-teal-600" />
            Insurance Verification
          </h1>
          <p className="text-gray-500 mt-1">Verify patient benefits before sessions</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-xl hover:bg-teal-700 transition-colors text-sm font-medium"
        >
          <Plus className="w-4 h-4" />
          Add Patient Insurance
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Total Records', value: records.length, color: 'gray' },
          { label: 'Active Coverage', value: activeCount, color: 'green' },
          { label: 'Needs Verification', value: pendingCount, color: 'yellow' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-2xl font-bold text-gray-900">{s.value}</p>
            <p className="text-sm text-gray-500">{s.label}</p>
          </div>
        ))}
      </div>

      {setupNeeded && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-blue-800">Automated verification not yet active</p>
            <p className="text-sm text-blue-600 mt-0.5">
              Add <code className="bg-blue-100 px-1 rounded">STEDI_API_KEY</code> to Railway to enable real-time eligibility checks.{' '}
              <a href="https://www.stedi.com/app/api-keys" target="_blank" rel="noreferrer" className="underline">Get a free Stedi API key →</a>
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-4 flex items-center gap-2 text-red-700 text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
          <button onClick={() => setError(null)} className="ml-auto"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Add Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Add Insurance Record</h2>
              <button onClick={() => { setShowForm(false); setForm(emptyForm); }} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Patient Name *</label>
                  <input value={form.patient_name} onChange={e => setForm(f => ({...f, patient_name: e.target.value}))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" placeholder="Jane Smith" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Date of Birth</label>
                  <input type="date" value={form.patient_dob} onChange={e => setForm(f => ({...f, patient_dob: e.target.value}))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Insurance Company *</label>
                <select value={form.insurance_company} onChange={e => setForm(f => ({...f, insurance_company: e.target.value}))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400">
                  <option value="">Select insurer...</option>
                  {INSURANCE_COMPANIES.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Member ID *</label>
                  <input value={form.member_id} onChange={e => setForm(f => ({...f, member_id: e.target.value}))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" placeholder="ABC123456789" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Group Number</label>
                  <input value={form.group_number} onChange={e => setForm(f => ({...f, group_number: e.target.value}))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" placeholder="GRP001" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Relationship to Subscriber</label>
                <select value={form.relationship} onChange={e => setForm(f => ({...f, relationship: e.target.value}))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400">
                  <option value="self">Self</option>
                  <option value="spouse">Spouse</option>
                  <option value="child">Child</option>
                  <option value="other">Other</option>
                </select>
              </div>

              {form.relationship !== 'self' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Subscriber Name</label>
                    <input value={form.subscriber_name} onChange={e => setForm(f => ({...f, subscriber_name: e.target.value}))}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" placeholder="John Smith" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Subscriber DOB</label>
                    <input type="date" value={form.subscriber_dob} onChange={e => setForm(f => ({...f, subscriber_dob: e.target.value}))}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
                  </div>
                </div>
              )}
            </div>

            {error && <p className="text-red-600 text-xs mt-3">{error}</p>}

            <div className="flex gap-3 mt-5">
              <button onClick={() => { setShowForm(false); setForm(emptyForm); }} className="flex-1 px-4 py-2 border border-gray-200 rounded-lg text-gray-700 text-sm hover:bg-gray-50">Cancel</button>
              <button onClick={handleSave} disabled={saving || !form.patient_name || !form.insurance_company || !form.member_id}
                className="flex-1 px-4 py-2 bg-teal-600 text-white rounded-lg text-sm hover:bg-teal-700 disabled:opacity-50">
                {saving ? 'Saving...' : 'Save & Verify'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Records Table */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-6 h-6 border-2 border-teal-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : records.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center">
          <Shield className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-600 font-medium">No insurance records yet</p>
          <p className="text-sm text-gray-400 mt-1">Add a patient's insurance to verify eligibility before their session</p>
        </div>
      ) : (
        <div className="space-y-2">
          {records.map(record => (
            <div key={record.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="p-4 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 flex-wrap">
                    <p className="font-semibold text-gray-900">{record.patient_name}</p>
                    <StatusBadge check={record.latest_check} />
                  </div>
                  <p className="text-sm text-gray-500 mt-0.5">
                    {record.insurance_company} · Member ID: {record.member_id}
                    {record.group_number && ` · Group: ${record.group_number}`}
                  </p>
                  {record.latest_check?.is_active && (
                    <div className="flex gap-4 mt-1.5 text-xs text-gray-500">
                      {record.latest_check.copay_amount !== null && (
                        <span>Copay: <strong className="text-gray-700">${record.latest_check.copay_amount}</strong></span>
                      )}
                      {record.latest_check.deductible_total !== null && (
                        <span>Deductible: <strong className="text-gray-700">${record.latest_check.deductible_met ?? '?'} / ${record.latest_check.deductible_total} met</strong></span>
                      )}
                      {record.latest_check.mental_health_covered && (
                        <span className="text-green-600">✓ Mental health covered</span>
                      )}
                    </div>
                  )}
                  {record.latest_check?.checked_at && (
                    <p className="text-xs text-gray-400 mt-0.5">
                      Last checked: {new Date(record.latest_check.checked_at).toLocaleDateString()}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => handleVerify(record)}
                    disabled={verifying === record.id}
                    className="flex items-center gap-1.5 px-3 py-1.5 border border-teal-200 text-teal-700 rounded-lg text-xs hover:bg-teal-50 transition-colors disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3 h-3 ${verifying === record.id ? 'animate-spin' : ''}`} />
                    {verifying === record.id ? 'Checking...' : 'Verify'}
                  </button>
                  <button
                    onClick={() => setExpanded(expanded === record.id ? null : record.id)}
                    className="p-1.5 text-gray-400 hover:text-gray-600"
                  >
                    {expanded === record.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                  <button onClick={() => handleDelete(record.id)} className="p-1.5 text-gray-300 hover:text-red-500">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {expanded === record.id && (
                <div className="px-4 pb-4 pt-0 border-t border-gray-100 bg-gray-50">
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-3 text-sm">
                    <div><p className="text-xs text-gray-400">Patient DOB</p><p className="text-gray-700">{record.patient_dob || '—'}</p></div>
                    <div><p className="text-xs text-gray-400">Subscriber</p><p className="text-gray-700">{record.subscriber_name || record.patient_name}</p></div>
                    <div><p className="text-xs text-gray-400">Relationship</p><p className="text-gray-700 capitalize">{record.relationship_to_subscriber}</p></div>
                    {record.latest_check?.error_message && (
                      <div className="col-span-3">
                        <p className="text-xs text-gray-400">Last error</p>
                        <p className="text-red-600 text-xs">{record.latest_check.error_message}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </main>
  )
}
