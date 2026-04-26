// Resend an existing intake form (reuses the existing token; refreshes
// expires_at by 7 days). Email-only on AWS; SMS pending SignalWire.

import { NextResponse, type NextRequest } from 'next/server'
import { pool } from '@/lib/aws/db'
import { sendPatientEmail, buildIntakeEmail } from '@/lib/email'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as any
  const intakeId = body?.intake_form_id
  if (!intakeId) {
    return NextResponse.json({ error: 'intake_form_id is required' }, { status: 400 })
  }

  const formRow = await pool.query(
    `SELECT id, token, practice_id, patient_id, patient_name,
            patient_phone, patient_email, status
       FROM intake_forms WHERE id = $1 LIMIT 1`,
    [intakeId],
  ).catch(() => ({ rows: [] as any[] }))
  const form = formRow.rows[0]
  if (!form) return NextResponse.json({ error: 'Intake form not found' }, { status: 404 })
  if (!form.token) return NextResponse.json({ error: 'Intake form has no token - cannot resend' }, { status: 400 })

  const practiceRow = await pool.query(
    `SELECT name FROM practices WHERE id = $1 LIMIT 1`, [form.practice_id],
  ).catch(() => ({ rows: [] as any[] }))
  const practice = practiceRow.rows[0]
  if (!practice) return NextResponse.json({ error: 'Practice not found' }, { status: 404 })

  // Refresh the expiry on resend so the link doesn't 410 immediately.
  const newExpiry = new Date()
  newExpiry.setDate(newExpiry.getDate() + 7)
  await pool.query(
    `UPDATE intake_forms SET expires_at = $1 WHERE id = $2`,
    [newExpiry.toISOString(), form.id],
  ).catch(() => {})

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'https://lab.harboroffice.ai'
  const intakeUrl = `${baseUrl.replace(/\/$/, '')}/intake/${form.token}`
  const practiceName = practice.name || 'the practice'
  const firstName = (form.patient_name as string)?.split(' ')[0] || 'there'

  let emailSent = false
  let emailReason: string | null = null
  if (form.patient_email) {
    try {
      const { subject, html, from } = buildIntakeEmail({
        practiceName, patientName: firstName, intakeUrl,
      })
      const { sent, skipped } = await sendPatientEmail({
        practiceId: form.practice_id, to: form.patient_email, subject, html,
        from: `${practiceName} <${from}>`,
      })
      emailSent = sent
      if (!sent) {
        emailReason = skipped === 'opted_out'
          ? 'recipient_opted_out'
          : 'ses_not_verified_or_send_failed'
      }
    } catch (err) {
      emailReason = `error: ${(err as Error).message}`
    }
  }

  const smsPending = !!form.patient_phone

  pool.query(
    `INSERT INTO audit_logs (user_id, user_email, practice_id, action, resource_type, resource_id, details)
     VALUES (NULL, NULL, $1, 'intake.resend', 'intake_form', $2, $3::jsonb)`,
    [form.practice_id, form.id,
     JSON.stringify({ email_sent: emailSent, email_reason: emailReason, sms_pending: smsPending })],
  ).catch(() => {})

  return NextResponse.json({
    success: true,
    intake_url: intakeUrl,
    email_sent: emailSent,
    email_reason: emailReason,
    sms_sent: false,
    sms_pending: smsPending ? 'awaiting_signalwire' : false,
    expires_at: newExpiry.toISOString(),
  })
}
