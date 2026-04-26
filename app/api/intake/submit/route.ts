// Patient-facing intake form — load + submit.
//
// GET  ?token=...  — hydrate the form (practice info + intake_documents).
// POST             — submit answers + signatures. The 5-table write is
//                    wrapped in a pool transaction (BEGIN/COMMIT/ROLLBACK)
//                    so the patient never lands in a half-completed state.
//                    Best-effort tasks (eligibility precheck, communication
//                    log) run AFTER COMMIT — they should never block the
//                    submission outcome.
//
// AWS canonical schema gaps the legacy code worked around:
//   patients.intake_completed / intake_completed_at / sms_consent_given_at /
//   sms_consent_text_version / sms_consent_ip / referral_source / billing_mode
//   are NOT on the canonical patients schema. A defensive secondary UPDATE
//   wrapped in try/catch tries to set them anyway — succeeds when migrations
//   added the columns, no-ops when they didn't.

import { NextResponse, type NextRequest } from 'next/server'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
import { runAndPersistEligibilityCheck } from '@/lib/aws/stedi/eligibility'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SMS_CONSENT_TEXT_VERSION = 'v2-2026-04-20-hipaa-disclosure'

// ---------- scoring helpers (pure, lifted verbatim from legacy) ----------
function scorePHQ9(answers: number[]): { score: number; severity: string; recommendation: string } {
  const score = answers.reduce((a, b) => a + b, 0)
  let severity = '', recommendation = ''
  if (score <= 4)  { severity = 'Minimal';           recommendation = 'No treatment indicated at this time.' }
  else if (score <= 9)  { severity = 'Mild';        recommendation = 'Watchful waiting; repeat PHQ-9 at follow-up.' }
  else if (score <= 14) { severity = 'Moderate';    recommendation = 'Treatment plan; may benefit from counseling.' }
  else if (score <= 19) { severity = 'Moderately Severe'; recommendation = 'Active treatment with medication and/or therapy.' }
  else                   { severity = 'Severe';     recommendation = 'Immediate initiation of pharmacotherapy and, if severe impairment, refer.' }
  return { score, severity, recommendation }
}

function scoreGAD7(answers: number[]): { score: number; severity: string; recommendation: string } {
  const score = answers.reduce((a, b) => a + b, 0)
  let severity = '', recommendation = ''
  if (score <= 4)  { severity = 'Minimal';  recommendation = 'No anxiety intervention indicated at this time.' }
  else if (score <= 9)  { severity = 'Mild'; recommendation = 'Monitor; may not require treatment.' }
  else if (score <= 14) { severity = 'Moderate'; recommendation = 'Possible anxiety disorder; further evaluation warranted.' }
  else                   { severity = 'Severe';  recommendation = 'Active treatment strongly recommended.' }
  return { score, severity, recommendation }
}

function pickClientIp(headers: Headers): string | null {
  const fwd = headers.get('x-forwarded-for')
  if (fwd) {
    const first = fwd.split(',')[0]
    if (first?.trim()) return first.trim()
  }
  return headers.get('x-real-ip')
}

// ===========================================================================
// GET — hydrate the patient-facing form
// ===========================================================================
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  if (!token) return NextResponse.json({ error: 'Token required' }, { status: 400 })

  const intakeRes = await pool.query(
    `SELECT id, practice_id, status, patient_name, patient_phone,
            patient_email, expires_at, questionnaire_type
       FROM intake_forms
      WHERE token = $1 LIMIT 1`,
    [token],
  ).catch(() => ({ rows: [] as any[] }))
  const intake = intakeRes.rows[0]
  if (!intake) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let practiceName = ''
  let intakeConfig: Record<string, boolean> | null = null
  if (intake.practice_id) {
    const p = await pool.query(
      `SELECT name FROM practices WHERE id = $1 LIMIT 1`,
      [intake.practice_id],
    ).catch(() => ({ rows: [] as any[] }))
    practiceName = p.rows[0]?.name ?? ''
    // intake_config column may not exist on canonical practices — defensive.
    try {
      const cfg = await pool.query(
        `SELECT intake_config FROM practices WHERE id = $1 LIMIT 1`,
        [intake.practice_id],
      )
      intakeConfig = cfg.rows[0]?.intake_config?.sections ?? null
    } catch { /* column missing — leave null */ }
  }

  let documents: Array<{
    id: string; name: string; requires_signature: boolean
    content_url: string | null; description: string | null
  }> = []
  if (intake.practice_id) {
    try {
      const docs = await pool.query(
        `SELECT id, name, requires_signature, content_url, description
           FROM intake_documents
          WHERE practice_id = $1 AND active = true
          ORDER BY sort_order ASC NULLS LAST`,
        [intake.practice_id],
      )
      documents = docs.rows
    } catch { /* table missing on this cluster — empty list */ }
  }

  return NextResponse.json({
    valid: intake.status === 'pending' && new Date(intake.expires_at) > new Date(),
    status: intake.status,
    patient_name: intake.patient_name,
    patient_phone: intake.patient_phone,
    patient_email: intake.patient_email,
    practice_name: practiceName,
    questionnaire_type: intake.questionnaire_type,
    documents,
    intake_config: intakeConfig,
  })
}

// ===========================================================================
// POST — submit. Transactional 5-table write.
// ===========================================================================
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as any
  if (!body?.token) return NextResponse.json({ error: 'Token is required' }, { status: 400 })

  const {
    token, phq9_answers, gad7_answers, additional_notes,
    demographics, insurance, presenting_concerns, medications,
    medical_history, prior_therapy, substance_use, family_history,
    signature, signed_name, document_acknowledgments, document_signatures,
  } = body

  // 1. Pre-validate the token OUTSIDE the tx so we don't open a connection
  //    for an obviously bad request.
  const lookup = await pool.query(
    `SELECT id, practice_id, patient_id, patient_name, patient_phone,
            patient_email, status, expires_at
       FROM intake_forms WHERE token = $1 LIMIT 1`,
    [token],
  ).catch(() => ({ rows: [] as any[] }))
  const intake = lookup.rows[0]
  if (!intake || intake.status !== 'pending') {
    return NextResponse.json({ error: 'Invalid or expired intake form' }, { status: 404 })
  }
  if (new Date(intake.expires_at) < new Date()) {
    return NextResponse.json(
      { error: 'This intake form has expired. Please contact your therapist.' },
      { status: 410 },
    )
  }

  const phq9Result = phq9_answers?.length === 9 ? scorePHQ9(phq9_answers) : null
  const gad7Result = gad7_answers?.length === 7 ? scoreGAD7(gad7_answers) : null

  const patientName = demographics?.first_name && demographics?.last_name
    ? `${demographics.first_name} ${demographics.last_name}`
    : intake.patient_name

  const clientIp = pickClientIp(req.headers)
  const completedAt = new Date().toISOString()

  // 2. Transactional write across intake_forms + patient_assessments +
  //    intake_document_signatures + patients. Single client checkout, single
  //    BEGIN/COMMIT, single ROLLBACK on any error.
  const client = await pool.connect()
  let resolvedPatientId: string | null = intake.patient_id ?? null
  try {
    await client.query('BEGIN')

    // 2a. UPDATE intake_forms — status='completed' + all field data + signature.
    const updateRes = await client.query(
      `UPDATE intake_forms
          SET status = 'completed',
              patient_name = $1,
              patient_phone = $2,
              patient_email = $3,
              patient_dob = $4,
              patient_address = $5,
              demographics = $6::jsonb,
              insurance = $7::jsonb,
              signature_data = $8,
              signed_name = $9,
              phq9_answers = $10::jsonb,
              phq9_score = $11,
              phq9_severity = $12,
              gad7_answers = $13::jsonb,
              gad7_score = $14,
              gad7_severity = $15,
              presenting_concerns = $16,
              medications = $17,
              medical_history = $18,
              prior_therapy = $19,
              substance_use = $20,
              family_history = $21,
              additional_notes = $22,
              completed_at = $23
        WHERE id = $24 AND status = 'pending'
        RETURNING id`,
      [
        patientName,
        demographics?.phone || intake.patient_phone,
        demographics?.email || intake.patient_email,
        demographics?.date_of_birth || null,
        demographics
          ? [demographics.address, demographics.city, demographics.state, demographics.zip]
              .filter(Boolean).join(', ')
          : null,
        JSON.stringify(demographics ?? null),
        JSON.stringify(insurance ?? null),
        signature ?? null,
        signed_name ?? null,
        phq9_answers ? JSON.stringify(phq9_answers) : null,
        phq9Result?.score ?? null,
        phq9Result?.severity ?? null,
        gad7_answers ? JSON.stringify(gad7_answers) : null,
        gad7Result?.score ?? null,
        gad7Result?.severity ?? null,
        presenting_concerns ?? null,
        medications ?? null,
        medical_history ?? null,
        prior_therapy ?? null,
        substance_use ?? null,
        family_history ?? null,
        additional_notes ?? null,
        completedAt,
      ],
    )
    // Optimistic lock — if RETURNING is empty, another submission already
    // completed this form. ROLLBACK and return success-of-already-saved so
    // the patient sees a sane result on a double-submit.
    if (!updateRes.rows[0]) {
      await client.query('ROLLBACK')
      client.release()
      return NextResponse.json({
        success: true,
        already_submitted: true,
        message: 'This form has already been submitted. Thank you!',
      })
    }

    // 2b. INSERT patient_assessments (PHQ-9 + GAD-7). Skip if no patient_id
    //     can be resolved — the assessment row needs one. We attempt to
    //     resolve it by phone fall-back when intake_forms didn't carry it.
    if (!resolvedPatientId && intake.patient_phone) {
      const normalized = (intake.patient_phone as string).replace(/\D/g, '').slice(-10)
      if (normalized.length >= 10) {
        const found = await client.query(
          `SELECT id FROM patients
            WHERE practice_id = $1 AND phone ILIKE $2
            LIMIT 1`,
          [intake.practice_id, `%${normalized}`],
        )
        resolvedPatientId = found.rows[0]?.id ?? null
      }
    }

    if (resolvedPatientId && phq9Result) {
      await client.query(
        `INSERT INTO patient_assessments (
           practice_id, patient_id, patient_name, assessment_type,
           score, severity, responses_json, administered_by,
           intake_form_id, completed_at
         ) VALUES (
           $1, $2, $3, 'phq9',
           $4, $5, $6::jsonb, 'intake_form',
           $7, $8
         )`,
        [
          intake.practice_id, resolvedPatientId, patientName ?? null,
          phq9Result.score,
          phq9Result.severity?.toLowerCase().replace(/ /g, '_'),
          JSON.stringify({ answers: phq9_answers }),
          intake.id, completedAt,
        ],
      )
    }
    if (resolvedPatientId && gad7Result) {
      await client.query(
        `INSERT INTO patient_assessments (
           practice_id, patient_id, patient_name, assessment_type,
           score, severity, responses_json, administered_by,
           intake_form_id, completed_at
         ) VALUES (
           $1, $2, $3, 'gad7',
           $4, $5, $6::jsonb, 'intake_form',
           $7, $8
         )`,
        [
          intake.practice_id, resolvedPatientId, patientName ?? null,
          gad7Result.score,
          gad7Result.severity?.toLowerCase().replace(/ /g, '_'),
          JSON.stringify({ answers: gad7_answers }),
          intake.id, completedAt,
        ],
      )
    }

    // 2c. INSERT intake_document_signatures — one per acked + signed doc.
    if (document_acknowledgments && typeof document_acknowledgments === 'object') {
      const docIds = Object.keys(document_acknowledgments).filter(id => document_acknowledgments[id])
      for (const docId of docIds) {
        const sigData = document_signatures?.[docId] ?? null
        await client.query(
          `INSERT INTO intake_document_signatures (
             intake_form_id, intake_document_id, signed_name,
             signed_at, signature_image, additional_fields
           ) VALUES ($1, $2, $3, $4, $5, NULL)`,
          [intake.id, docId, signed_name ?? null, completedAt, sigData],
        )
      }
    }

    // 2d. UPDATE patients — sync canonical demographics + insurance fields
    //     in the main UPDATE. Legacy-only columns (intake_completed,
    //     sms_consent_*, referral_source) handled in a defensive secondary
    //     UPDATE outside the tx (see step 3 below) so a missing-column
    //     error doesn't roll back the whole submission.
    if (resolvedPatientId) {
      const sets: string[] = []
      const args: unknown[] = []
      const push = (col: string, val: unknown) => {
        if (val === null || val === undefined) return
        args.push(val)
        sets.push(`${col} = $${args.length}`)
      }
      push('first_name', demographics?.first_name)
      push('last_name', demographics?.last_name)
      push('preferred_name', demographics?.preferred_name)
      push('pronouns', demographics?.pronouns)
      push('date_of_birth', demographics?.date_of_birth)
      push('phone', demographics?.phone)
      push('email', demographics?.email)
      push('address_line_1', demographics?.address)
      push('city', demographics?.city)
      push('state', demographics?.state)
      push('postal_code', demographics?.zip)
      push('emergency_contact_name', demographics?.emergency_contact_name)
      push('emergency_contact_phone', demographics?.emergency_contact_phone)

      // Insurance: canonical column names
      const carrier = insurance?.insurance_provider || insurance?.provider
      const memberId = insurance?.policy_number || insurance?.member_id
      push('insurance_provider', carrier)
      push('insurance_member_id', memberId)
      push('insurance_group_id', insurance?.group_number)

      // SMS consent (canonical sms_consent_granted + sms_consent_granted_at)
      if (demographics?.sms_consent === true) {
        push('sms_consent_granted', true)
        push('sms_consent_granted_at', completedAt)
      }

      if (sets.length > 0) {
        args.push(resolvedPatientId, intake.practice_id)
        await client.query(
          `UPDATE patients
              SET ${sets.join(', ')}, updated_at = NOW()
            WHERE id = $${args.length - 1}
              AND practice_id = $${args.length}`,
          args,
        )
      }
    }

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    console.error('[intake/submit] tx rollback:', (err as Error).message)
    return NextResponse.json(
      { error: 'Failed to save your responses' },
      { status: 500 },
    )
  } finally {
    client.release()
  }

  // 3. POST-COMMIT BEST-EFFORT TASKS
  //    Failures here do NOT roll back the submission. The patient's data
  //    is durable; these are advisory side effects.

  // 3a. Defensive legacy-column update on patients (intake_completed,
  //     sms_consent_text_version, sms_consent_ip, referral_source,
  //     intake_completed_at). Each in its own try/catch so missing columns
  //     don't poison sibling updates.
  if (resolvedPatientId) {
    const tries: Array<[string, unknown[]]> = [
      [`UPDATE patients SET intake_completed = true, intake_completed_at = $1 WHERE id = $2`,
       [completedAt, resolvedPatientId]],
      [`UPDATE patients SET sms_consent_text_version = $1, sms_consent_ip = $2::inet WHERE id = $3 AND $4 = true`,
       [SMS_CONSENT_TEXT_VERSION, clientIp, resolvedPatientId, demographics?.sms_consent === true]],
      [`UPDATE patients SET referral_source = $1 WHERE id = $2`,
       [demographics?.referral_source ?? null, resolvedPatientId]],
    ]
    for (const [sql, args] of tries) {
      pool.query(sql, args).catch(() => {})
    }
  }

  // 3b. patient_communications inbound log (best-effort).
  pool.query(
    `INSERT INTO patient_communications (
       practice_id, patient_id, patient_phone, patient_email,
       channel, direction, content_summary, metadata
     ) VALUES ($1, $2, $3, $4, 'intake_form', 'inbound', $5, $6::jsonb)`,
    [
      intake.practice_id, resolvedPatientId,
      intake.patient_phone, demographics?.email ?? intake.patient_email,
      `Intake form completed by ${patientName ?? 'patient'}` +
        (phq9Result ? ` (PHQ-9: ${phq9Result.score})` : '') +
        (gad7Result ? ` (GAD-7: ${gad7Result.score})` : ''),
      JSON.stringify({ intake_form_id: intake.id, token }),
    ],
  ).catch(() => {})

  // 3c. Stedi eligibility precheck (best-effort).
  if (resolvedPatientId && insurance?.insurance_provider) {
    pool.query(
      `SELECT id, npi FROM practices WHERE id = $1 LIMIT 1`,
      [intake.practice_id],
    ).then(async ({ rows }) => {
      const practice = rows[0]
      if (!practice) return
      // Find or skip — we only run if there's already an insurance_records row.
      const ir = await pool.query(
        `SELECT id FROM insurance_records
          WHERE practice_id = $1 AND patient_id = $2
          ORDER BY updated_at DESC LIMIT 1`,
        [intake.practice_id, resolvedPatientId],
      ).catch(() => ({ rows: [] as any[] }))
      if (!ir.rows[0]) return
      await runAndPersistEligibilityCheck({
        insuranceRecordId: ir.rows[0].id,
        practice: { id: practice.id, name: null, npi: practice.npi ?? null },
        patient: { name: patientName ?? '', dob: demographics?.date_of_birth ?? null, phone: intake.patient_phone },
        insurance: {
          company: insurance?.insurance_provider ?? insurance?.provider ?? null,
          memberId: insurance?.policy_number ?? insurance?.member_id ?? null,
          groupNumber: insurance?.group_number ?? null,
        },
        subscriber: { name: null, dob: null },
        triggerSource: 'intake',
      })
    }).catch(() => {})
  }

  // 3d. Audit (system-event flavour — patient is not a Cognito user).
  pool.query(
    `INSERT INTO audit_logs (
       user_id, user_email, practice_id, action, resource_type, resource_id, details, severity
     ) VALUES (NULL, NULL, $1, 'intake.submit', 'intake_form', $2, $3::jsonb, 'info')`,
    [
      intake.practice_id, intake.id,
      JSON.stringify({
        patient_id: resolvedPatientId,
        phq9_score: phq9Result?.score ?? null,
        gad7_score: gad7Result?.score ?? null,
        document_signatures_count: document_signatures
          ? Object.keys(document_signatures).length : 0,
        signed_name: signed_name ?? null,
      }),
    ],
  ).catch(() => {})

  return NextResponse.json({
    success: true,
    phq9: phq9Result,
    gad7: gad7Result,
    message: 'Thank you! Your responses have been saved. Your therapist will review them before your appointment.',
  })
}
