// Therapist-side intake creation linked to an appointment_id.
// requireApiSession (Cognito). Email-only on AWS for now; SMS pending
// SignalWire (response shape carries sms_pending flag).

import { NextResponse, type NextRequest } from 'next/server'
import { randomBytes } from 'crypto'
import { requireApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { sendPatientEmail, buildIntakeEmail } from '@/lib/email'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const ctx = await requireApiSession()
  if (ctx instanceof NextResponse) return ctx
  if (!ctx.practice) return NextResponse.json({ error: 'Practice not found' }, { status: 404 })

  const body = await req.json().catch(() => null) as any
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const {
    appointment_id, patient_name, patient_phone, patient_email,
    questionnaire_type = 'phq9_gad7',
  } = body

  if (!appointment_id || (!patient_phone && !patient_email)) {
    return NextResponse.json(
      { error: 'appointment_id and at least one of patient_phone or patient_email are required' },
      { status: 400 },
    )
  }

  // intake_enabled check — column may not exist on canonical, defensive.
  try {
    const r = await pool.query(
      `SELECT intake_enabled FROM practices WHERE id = $1 LIMIT 1`,
      [ctx.practice.id],
    )
    if (r.rows[0]?.intake_enabled === false) {
      return NextResponse.json({ sent: false, message: 'Intake forms disabled for this practice' })
    }
  } catch { /* column missing — proceed */ }

  const token = randomBytes(20).toString('hex')
  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + 7)

  let intakeId: string
  try {
    const { rows } = await pool.query(
      `INSERT INTO intake_forms (
         token, practice_id, appointment_id, patient_name, patient_phone,
         patient_email, questionnaire_type, status, expires_at, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, NOW())
       RETURNING id`,
      [token, ctx.practice.id, appointment_id, patient_name ?? null,
       patient_phone ?? null, patient_email ?? null, questionnaire_type, expiresAt.toISOString()],
    )
    intakeId = rows[0].id
  } catch (err) {
    console.error('[intake/create] insert failed:', (err as Error).message)
    return NextResponse.json({ error: 'Failed to create intake form' }, { status: 500 })
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'https://lab.harboroffice.ai'
  const intakeUrl = `${baseUrl.replace(/\/$/, '')}/intake/${token}`

  // Email
  let emailSent = false
  let emailReason: string | null = null
  if (patient_email) {
    try {
      const { subject, html } = buildIntakeEmail({
        practiceName: ctx.practice.name,
        patientName: patient_name ?? undefined,
        intakeUrl,
      })
      const res = await sendPatientEmail({
        practiceId: ctx.practice.id, to: patient_email, subject, html,
      })
      emailSent = res.sent
      if (!emailSent) {
        emailReason = res.skipped === 'opted_out'
          ? 'recipient_opted_out'
          : 'ses_not_verified_or_send_failed'
      }
    } catch (err) {
      emailReason = `error: ${(err as Error).message}`
    }
  }

  // SMS pending
  const smsPending = !!patient_phone

  // Persist tracking on intake_forms (defensive — columns may not exist).
  pool.query(
    `UPDATE intake_forms
        SET email_sent = $1, email_sent_at = $2
      WHERE id = $3`,
    [emailSent, emailSent ? new Date().toISOString() : null, intakeId],
  ).catch(() => {})

  // Audit
  pool.query(
    `INSERT INTO audit_logs (user_id, user_email, practice_id, action, resource_type, resource_id, details)
     VALUES ($1, $2, $3, 'intake.create', 'intake_form', $4, $5::jsonb)`,
    [ctx.user.id, ctx.session.email, ctx.practice.id, intakeId,
     JSON.stringify({ appointment_id, email_sent: emailSent, email_reason: emailReason, sms_pending: smsPending })],
  ).catch(() => {})

  return NextResponse.json({
    created: true,
    intake_id: intakeId,
    token,
    intake_url: intakeUrl,
    email_sent: emailSent,
    email_reason: emailReason,
    sms_sent: false,
    sms_pending: smsPending ? 'awaiting_signalwire' : false,
    expires_at: expiresAt.toISOString(),
  })
}
