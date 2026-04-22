// app/dashboard/ehr/credentialing/page.tsx
// License + CEU + insurance-panel tracker for every clinician at the
// practice. Expiry warning at ≤90 days, critical at ≤30. Inline edit.

'use client'

import { useEffect, useState } from 'react'
import { ShieldCheck, AlertTriangle, Save } from 'lucide-react'

type Therapist = {
  id: string; display_name: string | null; credentials: string | null; is_primary: boolean | null
  license_number: string | null; license_state: string | null; license_type: string | null
  license_expires_at: string | null; npi: string | null
  ceu_hours_ytd: number | null; ceu_required_yearly: number | null; ceu_cycle_ends_at: string | null
  insurance_panels: string[]
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null
  const d = new Date(iso + 'T12:00:00').getTime()
  return Math.round((d - Date.now()) / (24 * 60 * 60 * 1000))
}

export default function CredentialingPage() {
  const [therapists, setTherapists] = useState<Therapist[] | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<Partial<Therapist>>({})
  const [saving, setSaving] = useState(false)

  async function load() {
    const r = await fetch('/api/ehr/therapists')
    if (r.ok) setTherapists((await r.json()).therapists || [])
  }
  useEffect(() => { load() }, [])

  function startEdit(t: Therapist) {
    setEditingId(t.id)
    setForm({ ...t })
  }

  async function save() {
    if (!editingId) return
    setSaving(true)
    try {
      const r = await fetch('/api/ehr/therapists', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          therapist_id: editingId,
          license_number: form.license_number ?? null,
          license_state: form.license_state ?? null,
          license_type: form.license_type ?? null,
          license_expires_at: form.license_expires_at ?? null,
          npi: form.npi ?? null,
          ceu_hours_ytd: form.ceu_hours_ytd ?? 0,
          ceu_required_yearly: form.ceu_required_yearly ?? null,
          ceu_cycle_ends_at: form.ceu_cycle_ends_at ?? null,
          insurance_panels: form.insurance_panels ?? [],
        }),
      })
      if (!r.ok) throw new Error('Failed')
      setEditingId(null); setForm({})
      await load()
    } catch (err) { alert(err instanceof Error ? err.message : 'Failed') }
    finally { setSaving(false) }
  }

  return (
    <div className="max-w-5xl mx-auto py-8 px-4 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900 flex items-center gap-2">
          <ShieldCheck className="w-6 h-6 text-teal-600" />
          Credentialing
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Licenses, CEUs, and insurance panels for every clinician. Expiries light up red at 30 days, amber at 90.
        </p>
      </div>

      {therapists === null ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : therapists.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-12 text-center text-sm text-gray-500">
          No therapist records yet.
        </div>
      ) : (
        <div className="space-y-4">
          {therapists.map((t) => {
            const daysLicense = daysUntil(t.license_expires_at)
            const expiring = daysLicense != null && daysLicense <= 90
            const critical = daysLicense != null && daysLicense <= 30
            const ceuPct = t.ceu_required_yearly
              ? Math.min(100, ((t.ceu_hours_ytd || 0) / t.ceu_required_yearly) * 100)
              : null
            const isEditing = editingId === t.id
            return (
              <div key={t.id} className="bg-white border border-gray-200 rounded-xl p-4">
                <div className="flex items-center justify-between gap-4 mb-3">
                  <div>
                    <div className="text-lg font-semibold text-gray-900">
                      {t.display_name || 'Clinician'}
                      {t.credentials && <span className="text-xs text-gray-500 ml-1.5">{t.credentials}</span>}
                    </div>
                    {t.is_primary && <div className="text-[10px] uppercase tracking-wider text-teal-700">Primary clinician</div>}
                  </div>
                  {!isEditing ? (
                    <button onClick={() => startEdit(t)}
                      className="text-xs text-teal-700 hover:text-teal-900 font-medium">Edit</button>
                  ) : (
                    <div className="flex items-center gap-2">
                      <button onClick={() => { setEditingId(null); setForm({}) }} className="text-xs text-gray-600">Cancel</button>
                      <button onClick={save} disabled={saving}
                        className="inline-flex items-center gap-1 text-xs bg-teal-600 hover:bg-teal-700 text-white px-3 py-1.5 rounded-md disabled:opacity-50">
                        <Save className="w-3.5 h-3.5" />
                        {saving ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                  )}
                </div>

                {critical && <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-800 mb-3 flex items-center gap-2">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  License expires in {daysLicense} days — renew immediately.
                </div>}
                {!critical && expiring && <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800 mb-3 flex items-center gap-2">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  License expires in {daysLicense} days.
                </div>}

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <Field label="License type" value={t.license_type} editing={isEditing} onChange={(v) => setForm({ ...form, license_type: v })} placeholder="LCSW / LPC / LMFT" />
                  <Field label="License #" value={t.license_number} editing={isEditing} onChange={(v) => setForm({ ...form, license_number: v })} />
                  <Field label="State" value={t.license_state} editing={isEditing} onChange={(v) => setForm({ ...form, license_state: v })} placeholder="OR" />
                  <Field label="License expires" value={t.license_expires_at} type="date" editing={isEditing} onChange={(v) => setForm({ ...form, license_expires_at: v })}
                    display={t.license_expires_at ? `${t.license_expires_at} · ${daysLicense} days` : null} />
                  <Field label="NPI" value={t.npi} editing={isEditing} onChange={(v) => setForm({ ...form, npi: v })} />
                  <Field label="CEU hours YTD" value={t.ceu_hours_ytd?.toString() ?? null} type="number" editing={isEditing} onChange={(v) => setForm({ ...form, ceu_hours_ytd: v ? Number(v) : 0 })} />
                  <Field label="CEU required/year" value={t.ceu_required_yearly?.toString() ?? null} type="number" editing={isEditing} onChange={(v) => setForm({ ...form, ceu_required_yearly: v ? Number(v) : null })} />
                  <Field label="CEU cycle ends" value={t.ceu_cycle_ends_at} type="date" editing={isEditing} onChange={(v) => setForm({ ...form, ceu_cycle_ends_at: v })} />
                </div>

                {ceuPct !== null && (
                  <div className="mt-3">
                    <div className="text-xs text-gray-500 mb-1">
                      CEU progress: {t.ceu_hours_ytd || 0} / {t.ceu_required_yearly} hrs
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${ceuPct >= 100 ? 'bg-emerald-500' : ceuPct >= 50 ? 'bg-teal-500' : 'bg-amber-500'}`}
                        style={{ width: `${ceuPct}%` }} />
                    </div>
                  </div>
                )}

                <div className="mt-3">
                  <div className="text-xs uppercase tracking-wider text-gray-500 mb-1">Insurance panels</div>
                  {isEditing ? (
                    <input
                      value={(form.insurance_panels || []).join(', ')}
                      onChange={(e) => setForm({ ...form, insurance_panels: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
                      placeholder="Aetna, Blue Cross, Cigna…"
                      className="w-full border border-gray-200 rounded-lg px-2 py-1 text-sm"
                    />
                  ) : t.insurance_panels.length === 0 ? (
                    <span className="text-xs text-gray-400 italic">None on file</span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {t.insurance_panels.map((p) => (
                        <span key={p} className="px-2 py-0.5 rounded-full text-xs bg-teal-50 text-teal-800 border border-teal-200">{p}</span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Field({ label, value, display, editing, onChange, type = 'text', placeholder }: {
  label: string; value: string | null; display?: string | null; editing: boolean
  onChange: (v: string) => void; type?: string; placeholder?: string
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">{label}</div>
      {editing ? (
        <input
          type={type} value={value ?? ''} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
          className="w-full border border-gray-200 rounded-lg px-2 py-1 text-sm"
        />
      ) : (
        <div className="text-sm text-gray-900">{display ?? value ?? <span className="text-gray-400 italic">—</span>}</div>
      )}
    </div>
  )
}
