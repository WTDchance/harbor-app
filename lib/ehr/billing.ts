// lib/ehr/billing.ts
// Billing helpers. Fee schedule resolution + charge-from-signed-note
// logic lives here so the sign route can call it cleanly.

import { supabaseAdmin } from '@/lib/supabase'

// Fallback fee schedule (in cents) for CPT codes. Used when a practice
// hasn't configured its own. These are midpoint community rates that
// won't embarrass anyone but should be overridden per-practice.
export const DEFAULT_FEE_CENTS: Record<string, number> = {
  '90791': 20000, // intake
  '90792': 22500, // intake w/ medical
  '90832': 10000, // 30-min psychotherapy
  '90834': 15000, // 45-min
  '90837': 18000, // 60-min
  '90838': 15500, // 60-min add-on
  '90846': 15000, // family without patient
  '90847': 17500, // family with patient
  '90853': 7500,  // group
  '90839': 22000, // crisis first 60
  '90840': 12500, // crisis add-on 30
  '90785': 2500,  // interactive complexity add-on
  '96127': 3000,  // brief assessment
  '99354': 15000, // prolonged service add-on
}

export type BilledTo = 'insurance' | 'patient_self_pay' | 'both'

/** Pull the fee-cents for a CPT, preferring practice override. */
export function feeForCpt(
  cpt: string,
  practiceFeeSchedule: Record<string, number> | null | undefined,
): number {
  if (practiceFeeSchedule && typeof practiceFeeSchedule[cpt] === 'number') {
    return practiceFeeSchedule[cpt]
  }
  return DEFAULT_FEE_CENTS[cpt] ?? 15000 // reasonable default for unknown codes
}

/**
 * Create charges from a just-signed note. Called by /api/ehr/notes/[id]/sign
 * after it writes the signed row. Each CPT becomes one ehr_charges row.
 * Returns the created charge IDs (or empty if no CPT codes on the note).
 */
export async function createChargesForSignedNote(args: {
  practiceId: string
  note: any /* the signed note row */
  billingFeatureEnabled: boolean
}): Promise<{ created: string[]; skipped_reason?: string }> {
  if (!args.billingFeatureEnabled) {
    return { created: [], skipped_reason: 'billing_feature_disabled' }
  }
  const cpts: string[] = Array.isArray(args.note.cpt_codes) ? args.note.cpt_codes : []
  if (cpts.length === 0) {
    return { created: [], skipped_reason: 'no_cpt_codes' }
  }

  // Skip if charges already exist for this note (idempotent)
  const { data: existing } = await supabaseAdmin
    .from('ehr_charges').select('id').eq('note_id', args.note.id).limit(1).maybeSingle()
  if (existing?.id) return { created: [], skipped_reason: 'charges_exist' }

  // Practice fee schedule + billing config
  const { data: practice } = await supabaseAdmin
    .from('practices').select('default_fee_schedule_cents').eq('id', args.practiceId).maybeSingle()
  const schedule = (practice?.default_fee_schedule_cents as Record<string, number> | null) ?? {}

  // Patient billing mode (insurance/self-pay/both). Harbor has a billing_mode
  // column on patients already; default to insurance if not set.
  const { data: patient } = await supabaseAdmin
    .from('patients').select('billing_mode, insurance').eq('id', args.note.patient_id).maybeSingle()
  const billedTo: BilledTo =
    patient?.billing_mode === 'self_pay' ? 'patient_self_pay'
    : patient?.billing_mode === 'both' ? 'both'
    : 'insurance'

  // Telehealth → POS 02, else POS 11
  let pos: string | null = null
  if (args.note.appointment_id) {
    const { data: appt } = await supabaseAdmin
      .from('appointments').select('telehealth_room_slug').eq('id', args.note.appointment_id).maybeSingle()
    pos = appt?.telehealth_room_slug ? '02' : '11'
  }

  const rows = cpts.map((cpt) => {
    const fee = feeForCpt(cpt, schedule)
    return {
      practice_id: args.practiceId,
      patient_id: args.note.patient_id,
      note_id: args.note.id,
      appointment_id: args.note.appointment_id ?? null,
      cpt_code: cpt,
      units: 1,
      fee_cents: fee,
      allowed_cents: fee, // placeholder — actual allowed is set post-adjudication
      copay_cents: 0,
      billed_to: billedTo,
      status: 'pending' as const,
      service_date: args.note.signed_at ? args.note.signed_at.slice(0, 10) : new Date().toISOString().slice(0, 10),
      place_of_service: pos,
      created_by: args.note.signed_by,
    }
  })

  const { data, error } = await supabaseAdmin
    .from('ehr_charges').insert(rows).select('id')
  if (error) throw error
  return { created: (data ?? []).map((r: any) => r.id) }
}

/**
 * Load a patient's billing summary — balance, last charges, last payments.
 */
export async function patientBillingSummary(practiceId: string, patientId: string) {
  const [charges, payments] = await Promise.all([
    supabaseAdmin
      .from('ehr_charges')
      .select('id, cpt_code, units, fee_cents, allowed_cents, copay_cents, billed_to, status, service_date, created_at')
      .eq('practice_id', practiceId).eq('patient_id', patientId)
      .order('service_date', { ascending: false })
      .limit(25),
    supabaseAdmin
      .from('ehr_payments')
      .select('id, source, amount_cents, received_at, charge_id, note')
      .eq('practice_id', practiceId).eq('patient_id', patientId)
      .order('received_at', { ascending: false })
      .limit(25),
  ])

  let billed = 0
  let paid = 0
  let writtenOff = 0
  for (const c of charges.data ?? []) {
    if (c.status === 'void') continue
    billed += Number(c.allowed_cents) || 0
    if (c.status === 'paid') paid += Number(c.allowed_cents) || 0
    if (c.status === 'written_off') writtenOff += Number(c.allowed_cents) || 0
  }
  const pyTotal = (payments.data ?? []).reduce(
    (s: number, p: any) => s + (Number(p.amount_cents) || 0), 0,
  )
  const balance = Math.max(0, billed - pyTotal - writtenOff)

  return {
    balance_cents: balance,
    billed_cents: billed,
    received_cents: pyTotal,
    written_off_cents: writtenOff,
    charges: charges.data ?? [],
    payments: payments.data ?? [],
  }
}

export function centsToDollars(c: number | null | undefined): string {
  if (c == null) return '$0.00'
  const sign = c < 0 ? '-' : ''
  const abs = Math.abs(c)
  return `${sign}$${(abs / 100).toFixed(2)}`
}
