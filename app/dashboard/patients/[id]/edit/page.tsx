'use client'

// Wave 40 / P4 — Patient edit form with collapsible Demographics
// section for SOGI/REL.
//
// Primary intake fields stay visible; Demographics is hidden behind
// a collapsible header so it doesn't crowd the workflow. Every
// SOGI/REL field is optional and includes 'Prefer not to disclose'.
//
// HARD RULE — these fields are self-declared identity. They MUST NOT
// be read from AI/CDS code paths. Reference: UCSF Center for
// Excellence in Sexual Health Equity / SOGI Two-Step.

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, ChevronDown, ChevronRight, Save, Shield } from 'lucide-react'

interface Patient {
  id: string
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
  date_of_birth: string | null
  insurance_provider: string | null
  insurance_member_id: string | null
  insurance_group_number: string | null
  notes: string | null
  address_line_1: string | null
  city: string | null
  state: string | null
  postal_code: string | null
  pronouns: string | null
  emergency_contact_name: string | null
  emergency_contact_phone: string | null
  referral_source: string | null
  reason_for_seeking: string | null
  // Wave 40 / P4 SOGI/REL fields.
  race: string[] | null
  ethnicity: string[] | null
  primary_language: string | null
  sexual_orientation: string | null
  gender_identity: string | null
  pronouns_self_describe: string | null
  // Wave 41 / T6 sliding-fee tier assignment.
  fee_tier: string | null
}

interface SlidingFeeConfig {
  enabled: boolean
  config: Array<{ name: string; fee_pct: number }>
}

// UCSF / OMB-aligned options. "Prefer not to disclose" is always present
// per the brief and per UCSF guidance; "Choose not to disclose" is the
// SOGI two-step exact wording. We use UCSF's wording here.
const RACE_OPTIONS = [
  'American Indian or Alaska Native',
  'Asian',
  'Black or African American',
  'Native Hawaiian or Other Pacific Islander',
  'White',
  'Multiracial',
  'Other',
  'Choose not to disclose',
]

const ETHNICITY_OPTIONS = [
  'Hispanic or Latino/a/x',
  'Not Hispanic or Latino/a/x',
  'Choose not to disclose',
]

const SEXUAL_ORIENTATION_OPTIONS = [
  'Straight or heterosexual',
  'Lesbian or gay',
  'Bisexual',
  'Pansexual',
  'Asexual',
  'Queer',
  'Questioning',
  'Something else',
  'Choose not to disclose',
]

const GENDER_IDENTITY_OPTIONS = [
  'Woman',
  'Man',
  'Transgender woman',
  'Transgender man',
  'Non-binary',
  'Genderqueer',
  'Two-spirit',
  'Something else',
  'Choose not to disclose',
]

const COMMON_LANGUAGES = [
  'English', 'Spanish', 'Mandarin', 'Cantonese', 'Vietnamese',
  'Tagalog', 'Korean', 'Russian', 'Arabic', 'French', 'Portuguese',
  'American Sign Language', 'Other',
]

export default function EditPatientPage() {
  const params = useParams()
  const router = useRouter()
  const patientId = String(params.id)

  const [p, setP] = useState<Patient | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [demoOpen, setDemoOpen] = useState(false)
  const [slidingFee, setSlidingFee] = useState<SlidingFeeConfig | null>(null)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch(`/api/patients/${patientId}`, { credentials: 'include' })
      if (!res.ok) {
        setError(`Could not load patient (${res.status})`)
        return
      }
      const data = await res.json()
      setP(data?.patient ?? data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    ;(async () => {
      const res = await fetch('/api/ehr/practice/sliding-fee', { credentials: 'include' })
      if (res.ok) setSlidingFee(await res.json())
    })()
  }, [patientId])

  function update<K extends keyof Patient>(k: K, v: Patient[K]) {
    setP((prev) => prev ? { ...prev, [k]: v } : prev)
  }

  function toggleArray(field: 'race' | 'ethnicity', value: string) {
    setP((prev) => {
      if (!prev) return prev
      const cur = prev[field] ?? []
      const next = cur.includes(value)
        ? cur.filter((x) => x !== value)
        : [...cur, value]
      return { ...prev, [field]: next }
    })
  }

  async function save() {
    if (!p) return
    setSaving(true)
    setError(null)
    try {
      // Send only fields the API allows. Patch the patient.
      const body: Record<string, unknown> = {
        first_name: p.first_name ?? '',
        last_name: p.last_name ?? '',
        email: p.email ?? '',
        phone: p.phone ?? '',
        date_of_birth: p.date_of_birth ?? '',
        insurance_provider: p.insurance_provider ?? '',
        insurance_member_id: p.insurance_member_id ?? '',
        insurance_group_number: p.insurance_group_number ?? '',
        notes: p.notes ?? '',
        address_line_1: p.address_line_1 ?? '',
        city: p.city ?? '',
        state: p.state ?? '',
        postal_code: p.postal_code ?? '',
        pronouns: p.pronouns ?? '',
        emergency_contact_name: p.emergency_contact_name ?? '',
        emergency_contact_phone: p.emergency_contact_phone ?? '',
        referral_source: p.referral_source ?? '',
        reason_for_seeking: p.reason_for_seeking ?? '',
        // SOGI/REL — only sent if user has touched the section. We send
        // them unconditionally because backend handles empty/null safely.
        race: p.race ?? [],
        ethnicity: p.ethnicity ?? [],
        primary_language: p.primary_language ?? '',
        sexual_orientation: p.sexual_orientation ?? '',
        gender_identity: p.gender_identity ?? '',
        pronouns_self_describe: p.pronouns_self_describe ?? '',
        // Wave 41 / T6 sliding-fee tier
        fee_tier: p.fee_tier ?? '',
      }
      const res = await fetch(`/api/patients/${patientId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setError(data?.error || `Save failed (${res.status})`)
        return
      }
      router.push(`/dashboard/patients/${patientId}`)
    } catch (err: any) {
      setError(err?.message || 'Network error')
    } finally {
      setSaving(false)
    }
  }

  if (loading || !p) {
    return (
      <main className="flex-1 flex items-center justify-center min-h-[60vh]">
        <div className="w-6 h-6 border-2 border-teal-600 border-t-transparent rounded-full animate-spin" />
      </main>
    )
  }

  return (
    <main className="flex-1 max-w-3xl mx-auto w-full pb-32">
      <div className="px-4 pt-4">
        <Link
          href={`/dashboard/patients/${patientId}`}
          className="inline-flex items-center gap-1 text-sm text-teal-700 hover:text-teal-800"
          style={{ minHeight: 44 }}
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </Link>
        <h1 className="text-xl font-bold text-gray-900 mt-3">Edit patient</h1>
      </div>

      {error && (
        <div className="mx-4 mt-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">
          {typeof error === 'string' ? error : 'Save failed'}
        </div>
      )}

      <div className="mt-4 px-4 space-y-4">
        {/* Identity */}
        <Card title="Identity">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="First name" required>
              <input value={p.first_name ?? ''} onChange={(e) => update('first_name', e.target.value)}
                     className="ip" style={{ minHeight: 44 }} />
            </Field>
            <Field label="Last name" required>
              <input value={p.last_name ?? ''} onChange={(e) => update('last_name', e.target.value)}
                     className="ip" style={{ minHeight: 44 }} />
            </Field>
            <Field label="Date of birth">
              <input type="date" value={p.date_of_birth ?? ''} onChange={(e) => update('date_of_birth', e.target.value)}
                     className="ip" style={{ minHeight: 44 }} />
            </Field>
            <Field label="Pronouns (picker)">
              <select value={p.pronouns ?? ''} onChange={(e) => update('pronouns', e.target.value)}
                      className="ip" style={{ minHeight: 44 }}>
                <option value="">Not specified</option>
                <option value="he/him">he/him</option>
                <option value="she/her">she/her</option>
                <option value="they/them">they/them</option>
                <option value="he/they">he/they</option>
                <option value="she/they">she/they</option>
                <option value="other">Other (use self-describe in Demographics)</option>
              </select>
            </Field>
          </div>
        </Card>

        {/* Contact */}
        <Card title="Contact">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Phone" required>
              <input value={p.phone ?? ''} onChange={(e) => update('phone', e.target.value)}
                     className="ip" style={{ minHeight: 44 }} />
            </Field>
            <Field label="Email">
              <input type="email" value={p.email ?? ''} onChange={(e) => update('email', e.target.value)}
                     className="ip" style={{ minHeight: 44 }} />
            </Field>
            <Field label="Address">
              <input value={p.address_line_1 ?? ''} onChange={(e) => update('address_line_1', e.target.value)}
                     className="ip" style={{ minHeight: 44 }} />
            </Field>
            <div className="grid grid-cols-3 gap-2">
              <Field label="City">
                <input value={p.city ?? ''} onChange={(e) => update('city', e.target.value)} className="ip" style={{ minHeight: 44 }} />
              </Field>
              <Field label="State">
                <input value={p.state ?? ''} onChange={(e) => update('state', e.target.value)} className="ip" style={{ minHeight: 44 }} />
              </Field>
              <Field label="ZIP">
                <input value={p.postal_code ?? ''} onChange={(e) => update('postal_code', e.target.value)} className="ip" style={{ minHeight: 44 }} />
              </Field>
            </div>
          </div>
        </Card>

        {/* Insurance */}
        <Card title="Insurance">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Provider">
              <input value={p.insurance_provider ?? ''} onChange={(e) => update('insurance_provider', e.target.value)}
                     className="ip" style={{ minHeight: 44 }} />
            </Field>
            <Field label="Member ID">
              <input value={p.insurance_member_id ?? ''} onChange={(e) => update('insurance_member_id', e.target.value)}
                     className="ip" style={{ minHeight: 44 }} />
            </Field>
            <Field label="Group number">
              <input value={p.insurance_group_number ?? ''} onChange={(e) => update('insurance_group_number', e.target.value)}
                     className="ip" style={{ minHeight: 44 }} />
            </Field>
          </div>
        </Card>

        {/* Emergency + clinical */}
        <Card title="Emergency contact + clinical">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Emergency contact name">
              <input value={p.emergency_contact_name ?? ''} onChange={(e) => update('emergency_contact_name', e.target.value)}
                     className="ip" style={{ minHeight: 44 }} />
            </Field>
            <Field label="Emergency contact phone">
              <input value={p.emergency_contact_phone ?? ''} onChange={(e) => update('emergency_contact_phone', e.target.value)}
                     className="ip" style={{ minHeight: 44 }} />
            </Field>
            <Field label="Referral source">
              <input value={p.referral_source ?? ''} onChange={(e) => update('referral_source', e.target.value)}
                     className="ip" style={{ minHeight: 44 }} />
            </Field>
            <Field label="Reason for seeking care">
              <input value={p.reason_for_seeking ?? ''} onChange={(e) => update('reason_for_seeking', e.target.value)}
                     className="ip" style={{ minHeight: 44 }} />
            </Field>
            <div className="md:col-span-2">
              <Field label="Notes">
                <textarea value={p.notes ?? ''} onChange={(e) => update('notes', e.target.value)} rows={3}
                          className="ip" />
              </Field>
            </div>
          </div>
        </Card>

        {/* Billing — sliding-fee tier assignment.
            Card appears only when the practice has sliding fee enabled
            AND has configured tiers. Otherwise hidden so it doesn't
            clutter the form. */}
        {slidingFee?.enabled && slidingFee.config.length > 0 && (
          <Card title="Billing">
            <Field label="Sliding-fee tier">
              <select
                value={p.fee_tier ?? ''}
                onChange={(e) => update('fee_tier', e.target.value || null)}
                className="ip"
                style={{ minHeight: 44 }}
              >
                <option value="">No tier (full fee)</option>
                {slidingFee.config.map((t) => (
                  <option key={t.name} value={t.name}>
                    {t.name} — patient pays {t.fee_pct}%
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-500 mt-1">
                Charges generated for this patient will be multiplied by the
                tier's fee percentage. Leaving this blank bills at full fee.
              </p>
            </Field>
          </Card>
        )}

        {/* Demographics — collapsed by default */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <button
            type="button"
            onClick={() => setDemoOpen((v) => !v)}
            className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-gray-50"
            style={{ minHeight: 44 }}
          >
            {demoOpen ? <ChevronDown className="w-4 h-4 text-gray-500" /> : <ChevronRight className="w-4 h-4 text-gray-500" />}
            <Shield className="w-4 h-4 text-teal-700" />
            <span className="font-semibold text-gray-900">Demographics</span>
            <span className="text-xs text-gray-500 ml-auto">Optional · self-declared</span>
          </button>
          {demoOpen && (
            <div className="px-4 py-4 border-t border-gray-100 space-y-4">
              <p className="text-xs text-gray-600">
                These fields are <strong>optional</strong> and patient self-declared. Joint Commission and many state Medicaids
                require collection but never compulsion. Every option includes "Choose not to disclose."
                Reference: <a href="https://transcare.ucsf.edu/guidelines/data-collection" target="_blank" rel="noopener noreferrer" className="text-teal-700 underline">UCSF SOGI guidance</a>.
              </p>

              <CheckboxGroup
                label="Race (select all that apply)"
                options={RACE_OPTIONS}
                value={p.race ?? []}
                onToggle={(v) => toggleArray('race', v)}
              />

              <CheckboxGroup
                label="Ethnicity (select all that apply)"
                options={ETHNICITY_OPTIONS}
                value={p.ethnicity ?? []}
                onToggle={(v) => toggleArray('ethnicity', v)}
              />

              <Field label="Primary language">
                <select value={p.primary_language ?? ''} onChange={(e) => update('primary_language', e.target.value)}
                        className="ip" style={{ minHeight: 44 }}>
                  <option value="">Not specified</option>
                  {COMMON_LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
                  <option value="Choose not to disclose">Choose not to disclose</option>
                </select>
              </Field>

              <Field label="Sexual orientation">
                <select value={p.sexual_orientation ?? ''} onChange={(e) => update('sexual_orientation', e.target.value)}
                        className="ip" style={{ minHeight: 44 }}>
                  <option value="">Not specified</option>
                  {SEXUAL_ORIENTATION_OPTIONS.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </Field>

              <Field label="Gender identity">
                <select value={p.gender_identity ?? ''} onChange={(e) => update('gender_identity', e.target.value)}
                        className="ip" style={{ minHeight: 44 }}>
                  <option value="">Not specified</option>
                  {GENDER_IDENTITY_OPTIONS.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </Field>

              <Field label="Pronouns — self-describe">
                <input value={p.pronouns_self_describe ?? ''} onChange={(e) => update('pronouns_self_describe', e.target.value)}
                       placeholder="If the picker above doesn't capture your preference"
                       className="ip" style={{ minHeight: 44 }} />
              </Field>
            </div>
          )}
        </div>
      </div>

      <div
        className="fixed bottom-0 inset-x-0 bg-white border-t border-gray-200 p-3 z-30"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 12px)' }}
      >
        <div className="max-w-3xl mx-auto flex items-center justify-end gap-2 px-1">
          <Link
            href={`/dashboard/patients/${patientId}`}
            className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg"
            style={{ minHeight: 44 }}
          >
            Cancel
          </Link>
          <button
            onClick={save}
            disabled={saving || !p.first_name || !p.last_name || !p.phone}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 disabled:opacity-60"
            style={{ minHeight: 44 }}
          >
            <Save className="w-4 h-4" />
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      <style jsx>{`
        :global(.ip) {
          width: 100%;
          padding: 0.5rem;
          font-size: 0.875rem;
          border: 1px solid rgb(229 231 235);
          border-radius: 0.5rem;
        }
        :global(.ip:focus) {
          outline: none;
          box-shadow: 0 0 0 2px rgb(20 184 166 / 0.5);
        }
      `}</style>
    </main>
  )
}

function Card({ title, children }: { title: string; children: any }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <h2 className="text-sm font-semibold text-gray-900 mb-3">{title}</h2>
      {children}
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

function CheckboxGroup({
  label, options, value, onToggle,
}: { label: string; options: string[]; value: string[]; onToggle: (v: string) => void }) {
  return (
    <div>
      <div className="block text-xs font-medium text-gray-700 mb-2">{label}</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
        {options.map((opt) => {
          const checked = value.includes(opt)
          return (
            <label
              key={opt}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm cursor-pointer ${
                checked ? 'bg-teal-50 border-teal-300' : 'bg-white border-gray-200 hover:border-gray-300'
              }`}
              style={{ minHeight: 44 }}
            >
              <input type="checkbox" checked={checked} onChange={() => onToggle(opt)} className="rounded text-teal-600" />
              <span>{opt}</span>
            </label>
          )
        })}
      </div>
    </div>
  )
}
