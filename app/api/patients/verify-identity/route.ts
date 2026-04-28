// app/api/patients/verify-identity/route.ts
//
// Wave 19 (AWS port). Patient identity verification (HIPAA): match
// caller-supplied date_of_birth against the row before allowing any
// schedule mutation or PHI disclosure.
//
// Called by the voice server (Ellie) and the dashboard. The voice
// server hits this from the carrier-side; we keep it open (no Cognito
// auth) but require the practice_id to be supplied so the lookup is
// scoped — same posture as legacy. Bucket 1 carrier swap may add a
// shared-secret header later.
//
// First-verification pattern (legacy parity): if the patient row has
// no date_of_birth on file, we accept the supplied one and store it.
// All other cases require an exact match (normalized to YYYY-MM-DD).
//
// Audit: every verification attempt writes a row via auditSystemEvent
// with practice_id + patient_id + outcome (no DOB stored — only the
// outcome flag) so the forensic trail of "who got verified when"
// survives.

import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/aws/db'
import { auditSystemEvent } from '@/lib/aws/ehr/audit'

function normalizeDob(input: string): string | null {
  if (!input) return null
  const d = new Date(input)
  if (isNaN(d.getTime())) return null
  return d.toISOString().slice(0, 10)
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { patient_id, patient_phone, date_of_birth, practice_id } = body

    if (!date_of_birth || !practice_id) {
      return NextResponse.json(
        { error: 'date_of_birth and practice_id are required' },
        { status: 400 },
      )
    }
    if (!patient_id && !patient_phone) {
      return NextResponse.json(
        { error: 'Either patient_id or patient_phone is required' },
        { status: 400 },
      )
    }

    const params: any[] = [practice_id]
    let where = `practice_id = $1 AND deleted_at IS NULL`
    if (patient_id) {
      params.push(patient_id)
      where += ` AND id = $${params.length}`
    } else {
      params.push(patient_phone)
      where += ` AND phone = $${params.length}`
    }

    const { rows } = await pool.query(
      `SELECT id, first_name, last_name, date_of_birth
         FROM patients
        WHERE ${where}
        LIMIT 1`,
      params,
    )

    const patient = rows[0]
    if (!patient) {
      await auditSystemEvent({
        action: 'patients.verify_identity',
        severity: 'info',
        practiceId: practice_id,
        details: { outcome: 'patient_not_found', by: patient_id ? 'id' : 'phone' },
      })
      return NextResponse.json(
        { verified: false, reason: 'Patient not found' },
        { status: 404 },
      )
    }

    const supplied = normalizeDob(date_of_birth)
    if (!supplied) {
      return NextResponse.json(
        { verified: false, reason: 'Could not parse date_of_birth' },
        { status: 400 },
      )
    }

    // First-verification: no DOB on file → accept and store.
    if (!patient.date_of_birth) {
      await pool.query(
        `UPDATE patients SET date_of_birth = $1
          WHERE id = $2 AND practice_id = $3`,
        [supplied, patient.id, practice_id],
      )
      await auditSystemEvent({
        action: 'patients.verify_identity',
        severity: 'info',
        practiceId: practice_id,
        resourceType: 'patient',
        resourceId: patient.id,
        details: { outcome: 'verified_first_time' },
      })
      return NextResponse.json({
        verified: true,
        first_verification: true,
        patient_id: patient.id,
        patient_name: [patient.first_name, patient.last_name].filter(Boolean).join(' '),
      })
    }

    const stored = normalizeDob(patient.date_of_birth)
    if (stored === supplied) {
      await auditSystemEvent({
        action: 'patients.verify_identity',
        severity: 'info',
        practiceId: practice_id,
        resourceType: 'patient',
        resourceId: patient.id,
        details: { outcome: 'verified' },
      })
      return NextResponse.json({
        verified: true,
        first_verification: false,
        patient_id: patient.id,
        patient_name: [patient.first_name, patient.last_name].filter(Boolean).join(' '),
      })
    }

    await auditSystemEvent({
      action: 'patients.verify_identity',
      severity: 'warning',
      practiceId: practice_id,
      resourceType: 'patient',
      resourceId: patient.id,
      details: { outcome: 'dob_mismatch' },
    })
    return NextResponse.json({
      verified: false,
      reason: 'Date of birth does not match our records',
      patient_id: patient.id,
    })
  } catch (err) {
    console.error('[patients/verify-identity POST]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
