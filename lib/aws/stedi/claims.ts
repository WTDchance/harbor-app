// Stedi 837 professional claim submission — AWS port via pool.
//
// Mirror of lib/ehr/stedi-claim.ts. assembleClaim() is pure and lifted
// verbatim — the X12 wire shape must match what historical claims
// submitted against. submitClaimsForCharges() is rewritten on top of pool.

import { pool } from '@/lib/aws/db'

const STEDI_CLAIMS_URL =
  'https://healthcare.us.stedi.com/2024-04-01/change/medicalnetwork/professionalclaims/v3/submission'

export type ClaimSubmissionResult = {
  ok: boolean
  stediClaimId?: string | null
  controlNumber: string
  raw: any
  error?: string
}

export function newControlNumber(): string {
  // 9-digit numeric control number, padded.
  const seed = Date.now().toString().slice(-6) +
    Math.floor(Math.random() * 1000).toString().padStart(3, '0')
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
  patient_id?: string
  billed_to?: string
  status?: string
}

type PatientRow = {
  first_name: string
  last_name: string
  date_of_birth: string | null
}

type PracticeRow = {
  name: string
  billing_tax_id: string | null
  billing_npi: string | null
  billing_address: string | null
  phone_number: string | null
  stedi_mode?: string
}

type InsuranceRecord = {
  payer_id: string | null
  payer_name: string | null
  subscriber_id: string | null
  group_number: string | null
  plan_name: string | null
}

/**
 * Build a Stedi 837 claim JSON. Pure assembly, no network. Lifted verbatim
 * from legacy lib/ehr/stedi-claim.ts — the X12 wire shape MUST match
 * historical claims so reconciliation remains stable.
 */
export function assembleClaim(args: {
  charge: ChargeRow
  patient: PatientRow
  practice: PracticeRow
  insurance: InsuranceRecord
  diagnoses: string[]
  controlNumber: string
}): any {
  const { charge, patient, practice, insurance, diagnoses, controlNumber } = args
  const feeDollars = (charge.fee_cents / 100).toFixed(2)
  const dobRaw = patient.date_of_birth || ''
  const dob = dobRaw.replace(/-/g, '').slice(0, 8)
  const svcDate = charge.service_date.replace(/-/g, '')

  return {
    controlNumber,
    tradingPartnerServiceId: insurance.payer_id || 'SAMPLE_PAYER',
    submitter: {
      organizationName: practice.name,
      contactInformation: {
        name: practice.name,
        phoneNumber: (practice.phone_number || '').replace(/\D/g, ''),
      },
    },
    receiver: { organizationName: insurance.payer_name || 'Unknown Payer' },
    billing: {
      organizationName: practice.name,
      taxIdentificationNumber: practice.billing_tax_id || '',
      npi: practice.billing_npi || '',
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
      claimFilingCode: 'CI',
      patientControlNumber: charge.id,
      claimChargeAmount: feeDollars,
      placeOfServiceCode: charge.place_of_service || '11',
      claimFrequencyCode: '1',
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

export async function submitClaim(body: any): Promise<ClaimSubmissionResult> {
  const apiKey = process.env.STEDI_API_KEY
  if (!apiKey) {
    return {
      ok: false, controlNumber: body.controlNumber, raw: null,
      error: 'STEDI_API_KEY not configured',
    }
  }
  try {
    const resp = await fetch(STEDI_CLAIMS_URL, {
      method: 'POST',
      headers: { Authorization: `Key ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const raw = await resp.json().catch(() => ({}))
    if (!resp.ok) {
      return {
        ok: false, controlNumber: body.controlNumber, raw,
        error: raw?.error || raw?.message || `HTTP ${resp.status}`,
      }
    }
    return {
      ok: true,
      stediClaimId: raw?.claimId || raw?.id || null,
      controlNumber: body.controlNumber,
      raw,
    }
  } catch (err) {
    return {
      ok: false, controlNumber: body.controlNumber, raw: null,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * Convenience: load DB rows, assemble, submit, persist. Returns per-charge
 * outcome. Loop is per-charge but each charge writes its own claim row in
 * a small inline transaction so a partial failure of one claim doesn't
 * compromise the others.
 */
export async function submitClaimsForCharges(args: {
  practiceId: string
  chargeIds: string[]
}): Promise<Array<{
  charge_id: string
  claim_id?: string
  status: 'submitted' | 'rejected' | 'error'
  error?: string
}>> {
  const { practiceId, chargeIds } = args

  const practiceRes = await pool.query(
    `SELECT name, billing_tax_id, billing_npi, billing_address,
            phone_number, stedi_mode
       FROM practices WHERE id = $1 LIMIT 1`,
    [practiceId],
  ).catch(() => ({ rows: [] as any[] }))
  const practice = practiceRes.rows[0] as PracticeRow | undefined
  if (!practice) {
    return chargeIds.map(id => ({
      charge_id: id, status: 'error' as const, error: 'practice not found',
    }))
  }

  const chargesRes = await pool.query(
    `SELECT id, cpt_code, units, fee_cents, service_date,
            place_of_service, note_id, patient_id, billed_to, status
       FROM ehr_charges
      WHERE id = ANY($1::uuid[]) AND practice_id = $2`,
    [chargeIds, practiceId],
  ).catch(() => ({ rows: [] as any[] }))
  const charges: ChargeRow[] = chargesRes.rows

  const results: Array<{
    charge_id: string
    claim_id?: string
    status: 'submitted' | 'rejected' | 'error'
    error?: string
  }> = []

  for (const charge of charges) {
    if (charge.billed_to !== 'insurance' && charge.billed_to !== 'both') {
      results.push({ charge_id: charge.id, status: 'error', error: 'charge is not insurance-billable' })
      continue
    }
    if (charge.status !== 'pending') {
      results.push({ charge_id: charge.id, status: 'error', error: `charge already ${charge.status}` })
      continue
    }

    const [patientRes, insuranceRes, noteRes] = await Promise.all([
      pool.query(
        `SELECT first_name, last_name, date_of_birth
           FROM patients WHERE id = $1 LIMIT 1`,
        [charge.patient_id],
      ).catch(() => ({ rows: [] as any[] })),
      pool.query(
        `SELECT payer_id, payer_name, subscriber_id, group_number, plan_name
           FROM insurance_records
          WHERE patient_id = $1 AND practice_id = $2
          ORDER BY created_at DESC LIMIT 1`,
        [charge.patient_id, practiceId],
      ).catch(() => ({ rows: [] as any[] })),
      charge.note_id
        ? pool.query(
            `SELECT icd10_codes FROM ehr_progress_notes WHERE id = $1 LIMIT 1`,
            [charge.note_id],
          ).catch(() => ({ rows: [] as any[] }))
        : Promise.resolve({ rows: [] as any[] }),
    ])
    const patient = patientRes.rows[0] as PatientRow | undefined
    const insurance = insuranceRes.rows[0] as InsuranceRecord | undefined
    const diagnoses: string[] = (noteRes.rows[0]?.icd10_codes as string[] | null) ?? []

    if (!patient) { results.push({ charge_id: charge.id, status: 'error', error: 'patient not found' }); continue }
    if (!insurance) { results.push({ charge_id: charge.id, status: 'error', error: 'no insurance record on file' }); continue }

    const controlNumber = newControlNumber()
    const body = assembleClaim({ charge, patient, practice, insurance, diagnoses, controlNumber })

    let result: ClaimSubmissionResult
    if (practice.stedi_mode === 'production') {
      result = await submitClaim(body)
    } else {
      // Sandbox mode — synthesize "accepted" without hitting Stedi.
      result = {
        ok: true,
        controlNumber,
        stediClaimId: `sandbox_${controlNumber}`,
        raw: { sandbox: true, assembled: body },
      }
    }

    // Inline tx: insert claim + flip charge status. Atomic per-charge so
    // a partial batch doesn't leave an orphaned claim row without the
    // status flip.
    const client = await pool.connect()
    let claimId: string | undefined
    try {
      await client.query('BEGIN')
      const insertRes = await client.query(
        `INSERT INTO ehr_claims (
           practice_id, charge_id, payer_name, payer_id_external,
           control_number, status, submitted_at, stedi_claim_id,
           stedi_response_json, rejection_reason
         ) VALUES (
           $1, $2, $3, $4,
           $5, $6, NOW(), $7,
           $8::jsonb, $9
         ) RETURNING id`,
        [
          practiceId, charge.id, insurance.payer_name || 'Unknown',
          insurance.payer_id, controlNumber,
          result.ok ? 'submitted' : 'rejected',
          result.stediClaimId ?? null,
          JSON.stringify(result.raw ?? null),
          result.ok ? null : result.error,
        ],
      )
      claimId = insertRes.rows[0]?.id

      if (result.ok) {
        await client.query(
          `UPDATE ehr_charges SET status = 'submitted', updated_at = NOW()
            WHERE id = $1 AND practice_id = $2`,
          [charge.id, practiceId],
        )
      }
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      results.push({
        charge_id: charge.id, status: 'error',
        error: `claim persist failed: ${(err as Error).message}`,
      })
      client.release()
      continue
    }
    client.release()

    results.push(
      result.ok
        ? { charge_id: charge.id, claim_id: claimId, status: 'submitted' }
        : { charge_id: charge.id, claim_id: claimId, status: 'rejected', error: result.error },
    )
  }

  return results
}
