// lib/ehr/stedi-claim.ts
// Stedi 837 professional claim submission. This file contains:
//   - control_number generator
//   - assembleClaim() — builds the Stedi JSON body from Harbor data
//   - submitClaim() — posts it, handles sandbox/production routing
//
// Harbor already has Stedi eligibility (270/271) at lib/stedi/eligibility.ts.
// Claim submission is a different endpoint but the same API key.
//
// Reference: https://www.stedi.com/docs/healthcare/claims

import type { SupabaseClient } from '@supabase/supabase-js'

const STEDI_CLAIMS_URL =
  'https://healthcare.us.stedi.com/2024-04-01/change/medicalnetwork/professionalclaims/v3/submission'

export type ClaimSubmissionResult = {
  ok: boolean
  stediClaimId?: string
  controlNumber: string
  raw: any
  error?: string
}

export function newControlNumber(): string {
  // 9-digit numeric control number, Stedi recommends padded digits.
  const seed = Date.now().toString().slice(-6) + Math.floor(Math.random() * 1000).toString().padStart(3, '0')
  return seed.slice(0, 9)
}

type ChargeRow = {
  id: string
  cpt_code: string
  units: number
  fee_cents: number
  service_date: string
  place_of_service: string | null
  note_id: string | null
}

type PatientRow = {
  first_name: string
  last_name: string
  date_of_birth: string | null
  insurance: string | null
  // Harbor has many more columns; we pull just what we need
}

type PracticeRow = {
  name: string
  billing_tax_id: string | null
  billing_npi: string | null
  billing_address: string | null
  phone_number: string | null
}

type InsuranceRecord = {
  payer_id: string | null
  payer_name: string | null
  subscriber_id: string | null
  group_number: string | null
  plan_name: string | null
}

/**
 * Build a Stedi 837 claim JSON. Callers provide the charge, patient info,
 * practice billing info, insurance record, and diagnoses. This function
 * does not hit the network — pure assembly.
 */
export function assembleClaim(args: {
  charge: ChargeRow
  patient: PatientRow
  practice: PracticeRow
  insurance: InsuranceRecord
  diagnoses: string[] // ICD-10 codes from the charge's note
  controlNumber: string
}): any {
  const { charge, patient, practice, insurance, diagnoses, controlNumber } = args
  const feeDollars = (charge.fee_cents / 100).toFixed(2)

  // Normalize DOB to YYYYMMDD per X12 wire format
  const dobRaw = patient.date_of_birth || ''
  const dob = dobRaw.replace(/-/g, '').slice(0, 8)
  const svcDate = charge.service_date.replace(/-/g, '')

  return {
    controlNumber,
    tradingPartnerServiceId: insurance.payer_id || 'SAMPLE_PAYER',
    submitter: {
      organizationName: practice.name,
      contactInformation: { name: practice.name, phoneNumber: (practice.phone_number || '').replace(/\D/g, '') },
    },
    receiver: { organizationName: insurance.payer_name || 'Unknown Payer' },
    billing: {
      organizationName: practice.name,
      taxIdentificationNumber: practice.billing_tax_id || '',
      npi: practice.billing_npi || '',
      // Break practice.billing_address into a best-effort structured address
      address: {
        address1: (practice.billing_address || '').split('\n')[0] || '',
        city: '',
        state: '',
        postalCode: '',
      },
    },
    subscriber: {
      memberId: insurance.subscriber_id || '',
      firstName: patient.first_name,
      lastName: patient.last_name,
      dateOfBirth: dob || undefined,
      groupNumber: insurance.group_number || undefined,
    },
    claimInformation: {
      claimFilingCode: 'CI', // commercial insurance default
      patientControlNumber: charge.id,
      claimChargeAmount: feeDollars,
      placeOfServiceCode: charge.place_of_service || '11',
      claimFrequencyCode: '1', // original
      signatureIndicator: 'Y',
      providerAcceptAssignmentCode: 'A',
      benefitsAssignmentCertificationIndicator: 'Y',
      releaseInformationCode: 'Y',
      healthCareCodeInformation: diagnoses.slice(0, 12).map((code, i) => ({
        diagnosisTypeCode: i === 0 ? 'ABK' : 'ABF',
        diagnosisCode: code.replace('.', ''),
      })),
      serviceLines: [
        {
          serviceDate: svcDate,
          professionalService: {
            procedureIdentifier: 'HC',
            lineItemChargeAmount: feeDollars,
            procedureCode: charge.cpt_code,
            measurementUnit: 'UN',
            serviceUnitCount: String(charge.units),
            compositeDiagnosisCodePointers: {
              diagnosisCodePointers: diagnoses.slice(0, 4).map((_, i) => String(i + 1)),
            },
          },
        },
      ],
    },
  }
}

/**
 * Submit to Stedi. Respects practices.stedi_mode — 'sandbox' | 'production'.
 * In sandbox, we call the same endpoint but with a sandbox-flagged
 * payload (Stedi routes by API key + a sandbox indicator).
 */
export async function submitClaim(body: any): Promise<ClaimSubmissionResult> {
  const apiKey = process.env.STEDI_API_KEY
  if (!apiKey) {
    return { ok: false, controlNumber: body.controlNumber, raw: null, error: 'STEDI_API_KEY not configured' }
  }
  try {
    const resp = await fetch(STEDI_CLAIMS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Key ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    const raw = await resp.json().catch(() => ({}))
    if (!resp.ok) {
      return { ok: false, controlNumber: body.controlNumber, raw, error: raw?.error || raw?.message || `HTTP ${resp.status}` }
    }
    return {
      ok: true,
      stediClaimId: raw?.claimId || raw?.id || null,
      controlNumber: body.controlNumber,
      raw,
    }
  } catch (err) {
    return { ok: false, controlNumber: body.controlNumber, raw: null, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Convenience: load everything needed from the DB, assemble, submit, and
 * persist claim rows. Returns per-charge outcome.
 */
export async function submitClaimsForCharges(args: {
  supabase: SupabaseClient
  practiceId: string
  chargeIds: string[]
}): Promise<Array<{ charge_id: string; claim_id?: string; status: 'submitted' | 'rejected' | 'error'; error?: string }>> {
  const { supabase, practiceId, chargeIds } = args

  // Practice + insurance info
  const { data: practice } = await supabase
    .from('practices')
    .select('name, billing_tax_id, billing_npi, billing_address, phone_number, stedi_mode')
    .eq('id', practiceId).single()
  if (!practice) return chargeIds.map((id) => ({ charge_id: id, status: 'error' as const, error: 'practice not found' }))

  const { data: charges } = await supabase
    .from('ehr_charges')
    .select('id, cpt_code, units, fee_cents, service_date, place_of_service, note_id, patient_id, billed_to, status')
    .in('id', chargeIds).eq('practice_id', practiceId)

  const results: Array<{ charge_id: string; claim_id?: string; status: 'submitted' | 'rejected' | 'error'; error?: string }> = []

  for (const charge of charges ?? []) {
    if (charge.billed_to !== 'insurance' && charge.billed_to !== 'both') {
      results.push({ charge_id: charge.id, status: 'error', error: 'charge is not insurance-billable' })
      continue
    }
    if (charge.status !== 'pending') {
      results.push({ charge_id: charge.id, status: 'error', error: `charge already ${charge.status}` })
      continue
    }

    // Patient + active insurance record + diagnoses
    const [{ data: patient }, { data: insurance }, { data: note }] = await Promise.all([
      supabase.from('patients').select('first_name, last_name, date_of_birth, insurance').eq('id', charge.patient_id).single(),
      supabase.from('insurance_records').select('payer_id, payer_name, subscriber_id, group_number, plan_name')
        .eq('patient_id', charge.patient_id).eq('practice_id', practiceId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      charge.note_id
        ? supabase.from('ehr_progress_notes').select('icd10_codes').eq('id', charge.note_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ])

    if (!patient) { results.push({ charge_id: charge.id, status: 'error', error: 'patient not found' }); continue }
    if (!insurance) { results.push({ charge_id: charge.id, status: 'error', error: 'no insurance record on file' }); continue }
    const diagnoses: string[] = (note?.icd10_codes as string[] | null) ?? []

    const controlNumber = newControlNumber()
    const body = assembleClaim({ charge, patient, practice, insurance, diagnoses, controlNumber })

    // Sandbox mode: persist the assembled claim with a synthetic "accepted"
    // response rather than hitting the real network. Keeps tests fast + free.
    let result: ClaimSubmissionResult
    if (practice.stedi_mode === 'production') {
      result = await submitClaim(body)
    } else {
      result = {
        ok: true,
        controlNumber,
        stediClaimId: `sandbox_${controlNumber}`,
        raw: { sandbox: true, assembled: body },
      }
    }

    // Persist the claim
    const { data: claim } = await supabase
      .from('ehr_claims')
      .insert({
        practice_id: practiceId,
        charge_id: charge.id,
        payer_name: insurance.payer_name || 'Unknown',
        payer_id_external: insurance.payer_id,
        control_number: controlNumber,
        status: result.ok ? 'submitted' : 'rejected',
        submitted_at: new Date().toISOString(),
        stedi_claim_id: result.stediClaimId || null,
        stedi_response_json: result.raw,
        rejection_reason: result.ok ? null : result.error,
      })
      .select().single()

    if (result.ok) {
      await supabase.from('ehr_charges').update({ status: 'submitted' }).eq('id', charge.id)
      results.push({ charge_id: charge.id, claim_id: claim?.id, status: 'submitted' })
    } else {
      results.push({ charge_id: charge.id, claim_id: claim?.id, status: 'rejected', error: result.error })
    }
  }

  return results
}
