// Send intake form to a patient — email-only on AWS for now.
//
// SMS branch is intentionally stubbed pending the SignalWire/Retell carrier
// swap Chance is wiring himself. The intake_forms row gets created either
// way; the response shape tells the caller which channels actually fired so
// the dashboard can render "email sent ✓ / SMS pending".
//
// Auth: none — designed to be called by webhook (post-call AI flow) or
// dashboard. Practice resolution is via the explicit body.practice_id, with
// a fallback to patient_id → patients.practice_id.
//
// SES sandbox: sendPatientEmail returns false when the recipient isn't a
// verified identity. The response surfaces that as
// reason='ses_not_verified_or_send_failed' so dashboards can show a hint.

import { NextResponse, type NextRequest } from 'next/server'
import crypto from 'crypto'
import { pool } from '@/lib/aws/db'
import { sendPatientEmail, buildIntakeEmail } from '@/lib/email'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as any
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  let { practice_id, patient_id, call_log_id, patient_phone, patient_email, patient_name, delivery_method } = body

  // Resolve practice_id from patient if needed.
  if (!practice_id && patient_id) {
    const r = await pool.query(`SELECT practice_id FROM patients WHERE id = $1 LIMIT 1`, [patient_id])
      .catch(() => ({ rows: [] as any[] }))
    practice_id = r.rows[0]?.practice_id ?? null
  }
  if (!practice_id) {
    return NextResponse.json({ error: 'Missing practice_id and could not derive from patient' }, { status: 400 })
  }
  if (!patient_phone && !patient_email) {
    return NextResponse.json({ error: 'Need at least a phone or email to send intake forms' }, { status: 400 })
  }

  const practiceRow = await pool.query(
    `SELECT name FROM practices WHERE id = $1 LIMIT 1`, [practice_id],
  ).catch(() => ({ rows: [] as any[] }))
  const practice = practiceRow.rows[0]
  if (!practice) return NextResponse.json({ error: 'Practice not found' }, { status: 404 })

  // Mint token + create intake_forms row.
  const token = crypto.randomBytes(32).toString('hex')
  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + 7)

  let formId: string
  try {
    const { rows } = await pool.query(
      `INSERT INTO intake_forms (
         token, practice_id, patient_id, patient_name, patient_phone,
         patient_email, status, expires_at, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, NOW())
       RETURNING id`,
      [token, practice_id, patient_id ?? null, patient_name ?? null,
       patient_phone ?? null, patient_email ?? null, expiresAt.toISOString()],
    )
    formId = rows[0].id
  } catch (err) {
    console.error('[intake/send] failed to create intake_forms row:', (err as Error).message)
    return NextResponse.json({ error: 'Failed to create intake link' }, { status: 500 })
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'https://lab.harboroffice.ai'
  const intakeUrl = `${baseUrl.replace(/\/$/, '')}/intake/${token}`
  const practiceName = practice.name || 'the practice'
  const firstName = patient_name?.split(' ')[0] || 'there'

  // Decide effective channels (never default to SMS — email-only AWS path).
  const wantSms = (delivery_method === 'sms' || delivery_method === 'both' ||
                   (!delivery_method && patient_phone && !patient_email)) && !!patient_phone
  const wantEmail = (delivery_method === 'email' || delivery_method === 'both' ||
                     (!delivery_method && patient_email)) && !!patient_email

  let emailSent = false
  let emailReason: string | null = null

  if (wantEmail && patient_email) {
    try {
      const { subject, html, from } = buildIntakeEmail({
        practiceName, patientName: firstName, intakeUrl,
      })
      const { sent, skipped } = await sendPatientEmail({
        practiceId: practice_id, to: patient_email, subject, html,
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
    if (emailSent) {
      pool.query(
        `UPDATE intake_forms
            SET email_sent = true, email_sent_at = NOW()
          WHERE id = $1`, [formId],
      ).catch(() => {}) // tracking column may not exist — non-fatal
    }
  }

  // SMS pending — held for SignalWire swap.
  const smsPending = wantSms && !!patient_phone

  // Audit (system event — no Cognito user on the webhook path).
  pool.query(
    `INSERT INTO audit_logs (
       user_id, user_email, practice_id, action, resource_type, resource_id, details
     ) VALUES (NULL, NULL, $1, 'intake.send', 'intake_form', $2, $3::jsonb)`,
    [practice_id, formId, JSON.stringify({
      delivery_method, email_sent: emailSent, email_reason: emailReason,
      sms_pending: smsPending, call_log_id: call_log_id ?? null,
    })],
  ).catch(() => {})

  return NextResponse.json({
    success: true,
    form_id: formId,
    intake_url: intakeUrl,
    email_sent: emailSent,
    email_reason: emailReason,
    sms_sent: false,
    sms_pending: smsPending ? 'awaiting_signalwire' : false,
  })
}
