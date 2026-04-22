// app/dashboard/ehr/mandatory-reports/page.tsx
// Mandatory reporting log. Therapists create a new entry when they make a
// call to DHS / DCF / APS / law enforcement, or issue a duty-to-warn or
// duty-to-protect. Historical entries are searchable and audit-logged.

'use client'

import { useEffect, useState } from 'react'
import { ShieldAlert, Plus, ChevronLeft, X } from 'lucide-react'
import Link from 'next/link'

type Report = {
  id: string
  patient_id: string | null
  report_type: string
  reported_to: string
  reported_at: string
  incident_date: string | null
  summary: string
  basis_for_report: string | null
  follow_up: string | null
  reference_number: string | null
  status: string
  created_at: string
}

type Patient = { id: string; first_name: string; last_name: string }

const REPORT_TYPE_LABELS: Record<string, string> = {
  child_abuse: 'Suspected child abuse / neglect',
  elder_abuse: 'Suspected elder abuse',
  dependent_adult_abuse: 'Suspected dependent-adult abuse',
  duty_to_warn: 'Duty to warn (Tarasoff)',
  duty_to_protect: 'Duty to protect',
  other: 'Other mandatory report',
}

const TEMPLATES: Record<string, string> = {
  child_abuse:
    'Reporter: [therapist name and credentials].\n' +
    'Concern: describe the abuse/neglect disclosed or observed (who, what, when, where).\n' +
    'Basis: factual basis for the report — direct observations, patient disclosure, collateral info.\n' +
    'Safety: child\'s immediate safety status and next steps.\n' +
    'Contacted: agency + person + case/reference number.',
  elder_abuse:
    'Reporter: [therapist name and credentials].\n' +
    'Concern: describe the abuse / neglect / exploitation (financial, physical, emotional, sexual).\n' +
    'Basis: factual basis — observations, patient disclosure, collateral.\n' +
    'Safety: immediate risk to the older adult and next steps.\n' +
    'Contacted: Adult Protective Services / law enforcement + case number.',
  duty_to_warn:
    'Patient: identify patient with appropriate privilege-limited language.\n' +
    'Threat: identifiable intended target; nature of the threat; imminence.\n' +
    'Basis: what was said, when, collateral observations supporting credibility.\n' +
    'Action: warning to target, notification to law enforcement, crisis intervention.\n' +
    'Follow-up: safety planning, next session plan, notification confirmations.',
  duty_to_protect: 'Circumstances giving rise to duty to protect. Action taken. Follow-up plan.',
  dependent_adult_abuse: 'Concern, basis, safety status, contacted agency, follow-up.',
  other: 'Describe the circumstances requiring a mandatory report, basis, action taken, follow-up.',
}

export default function MandatoryReportsPage() {
  const [reports, setReports] = useState<Report[] | null>(null)
  const [patients, setPatients] = useState<Patient[]>([])
  const [patientMap, setPatientMap] = useState<Map<string, Patient>>(new Map())
  const [creating, setCreating] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [form, setForm] = useState<any>({
    patient_id: '',
    report_type: 'child_abuse',
    reported_to: '',
    incident_date: '',
    summary: TEMPLATES.child_abuse,
    basis_for_report: '',
    follow_up: '',
    reference_number: '',
  })

  async function load() {
    const res = await fetch('/api/ehr/mandatory-reports')
    if (res.ok) setReports((await res.json()).reports || [])
    // Patients for the dropdown — via /api/practice/me's practice_id + admin route
    const pres = await fetch('/api/practice/me')
    if (pres.ok) {
      const p = await pres.json()
      const r = await fetch(`/api/admin/patients?practice_id=${p.practice?.id}`)
      if (r.ok) {
        const j = await r.json()
        const arr: Patient[] = (j.patients || []).map((p: any) => ({ id: p.id, first_name: p.first_name, last_name: p.last_name }))
        setPatients(arr)
        setPatientMap(new Map(arr.map((pt) => [pt.id, pt])))
      }
    }
  }
  useEffect(() => { load() }, [])

  function updateType(type: string) {
    setForm((f: any) => ({ ...f, report_type: type, summary: TEMPLATES[type] || '' }))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.reported_to.trim() || !form.summary.trim()) return
    setSubmitting(true)
    try {
      const payload = { ...form, patient_id: form.patient_id || null, incident_date: form.incident_date || null }
      const res = await fetch('/api/ehr/mandatory-reports', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Failed')
      setCreating(false)
      setForm({ ...form, reported_to: '', summary: TEMPLATES[form.report_type], reference_number: '' })
      await load()
    } catch (err) { alert(err instanceof Error ? err.message : 'Failed') }
    finally { setSubmitting(false) }
  }

  return (
    <div className="max-w-5xl mx-auto py-8 px-4">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 flex items-center gap-2">
            <ShieldAlert className="w-6 h-6 text-red-600" />
            Mandatory Reporting Log
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Document child/elder abuse reports, duty-to-warn actions, and other mandatory notifications.
            Every entry is audit-logged.
          </p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg"
        >
          <Plus className="w-4 h-4" />
          New report
        </button>
      </div>

      {creating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Log a mandatory report</h3>
              <button onClick={() => setCreating(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={submit} className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Type</label>
                  <select
                    value={form.report_type}
                    onChange={(e) => updateType(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm"
                  >
                    {Object.entries(REPORT_TYPE_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Patient (optional — for anonymous reports)</label>
                  <select
                    value={form.patient_id}
                    onChange={(e) => setForm((f: any) => ({ ...f, patient_id: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm"
                  >
                    <option value="">— not linked —</option>
                    {patients.map((p) => (
                      <option key={p.id} value={p.id}>{p.first_name} {p.last_name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Reported to *</label>
                  <input
                    value={form.reported_to}
                    onChange={(e) => setForm((f: any) => ({ ...f, reported_to: e.target.value }))}
                    placeholder="e.g. Oregon DHS Child Welfare"
                    required
                    className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Incident date (if known)</label>
                  <input
                    type="date"
                    value={form.incident_date}
                    onChange={(e) => setForm((f: any) => ({ ...f, incident_date: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Summary *</label>
                <textarea
                  value={form.summary}
                  onChange={(e) => setForm((f: any) => ({ ...f, summary: e.target.value }))}
                  rows={8}
                  required
                  className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm font-mono"
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Basis for report</label>
                  <textarea
                    value={form.basis_for_report}
                    onChange={(e) => setForm((f: any) => ({ ...f, basis_for_report: e.target.value }))}
                    rows={3}
                    className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Follow-up</label>
                  <textarea
                    value={form.follow_up}
                    onChange={(e) => setForm((f: any) => ({ ...f, follow_up: e.target.value }))}
                    rows={3}
                    className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Reference / case number</label>
                <input
                  value={form.reference_number}
                  onChange={(e) => setForm((f: any) => ({ ...f, reference_number: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm"
                />
              </div>
              <div className="flex items-center justify-end gap-2 pt-2">
                <button type="button" onClick={() => setCreating(false)} className="px-4 py-2 text-sm text-gray-600">Cancel</button>
                <button type="submit" disabled={submitting}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg disabled:opacity-50">
                  {submitting ? 'Logging…' : 'Log report'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {reports === null ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : reports.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-12 text-center">
          <ShieldAlert className="w-10 h-10 mx-auto text-gray-300 mb-3" />
          <p className="text-sm text-gray-500">No mandatory reports logged yet. That&apos;s good.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {reports.map((r) => {
            const pt = r.patient_id ? patientMap.get(r.patient_id) : null
            return (
              <div key={r.id} className="bg-white border border-gray-200 rounded-xl p-4">
                <div className="flex items-center justify-between gap-4 mb-2">
                  <div>
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">
                      {REPORT_TYPE_LABELS[r.report_type] || r.report_type}
                    </span>
                    <span className="ml-2 text-xs text-gray-500">
                      {new Date(r.reported_at).toLocaleString()}
                    </span>
                  </div>
                  {pt && (
                    <Link href={`/dashboard/patients/${pt.id}`} className="text-xs text-teal-700 hover:text-teal-900">
                      {pt.first_name} {pt.last_name}
                    </Link>
                  )}
                </div>
                <div className="text-sm text-gray-900"><strong>To:</strong> {r.reported_to}</div>
                {r.reference_number && <div className="text-xs text-gray-500">Case / ref: {r.reference_number}</div>}
                <pre className="text-sm text-gray-800 mt-2 whitespace-pre-wrap font-sans">{r.summary}</pre>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
