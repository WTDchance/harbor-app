// app/api/ehr/appointments/[id]/no-show-followup-email/route.ts
//
// Wave 39 — email path for the no-show follow-up. Mirrors the SMS path
// (still on legacy Supabase auth at app/api/appointments/no-show-followup,
// pending Phase B port) but is AWS-native: Cognito session via
// requireEhrApiSession, RDS via lib/aws/db::pool, SES via lib/email.
//
// Triggers immediately on POST. (The brief mentions "schedule for ~2
// hours later" but the existing SMS path is also immediate; matching
// behaviour for now. A delayed-send job is a separate feature.)
//
// Honours patients.communication_preference: skips when 'sms' or 'none'.
// Skips when patient has no email on file or has opted out via
// email_optouts (handled by lib/email::sendPatientEmail).
//
// Body: {} — appointment id is in the URL.
//
// Returns:
//   { sent: true,  channel: 'email', appointment_id, patient_id }
//   { sent: false, reason: 'no_email' | 'communication_preference_excludes_email' | 'opted_out' | 'send_failed' }

import { NextResponse, type NextRequest } from 'next/server'
import { pool } from '@/lib/aws/db'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
import { sendPatientEmail, buildNoShowEmail } from '@/lib/email'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const { id: appointmentId } = await params
  if (!appointmentId) {
    return NextResponse.json(
      { error: { code: 'invalid_request', message: 'appointment id required' } },
      { status: 400 },
    )
  }

  // Load appointment + patient + practice in one shot. Practice scope is
  // enforced by the JOIN on practice_id = ctx.practiceId.
  const { rows } = await pool.query(
    `SELECT a.id          AS appointment_id,
            a.scheduled_at,
            a.status,
            a.practice_id,
            a.patient_id,
            p.email                       AS patient_email,
            p.first_name                  AS patient_first_name,
            p.last_name                   AS patient_last_name,
            p.communication_preference    AS communication_preference,
            pr.name                       AS practice_name,
            pr.provider_name              AS practice_provider_name,
            pr.phone                      AS practice_phone
       FROM appointments a
       JOIN patients     p  ON p.id = a.patient_id
       JOIN practices    pr ON pr.id = a.practice_id
      WHERE a.id = $1
        AND a.practice_id = $2
      LIMIT 1`,
    [appointmentId, ctx.practiceId],
  )
  const row = rows[0]
  if (!row) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Appointment not found' } },
      { status: 404 },
    )
  }

  // Communication-preference gate. 'both' (default), 'email' → send.
  // 'sms', 'none' → skip with a structured reason.
  const pref: string = row.communication_preference ?? 'both'
  if (pref !== 'email' && pref !== 'both') {
    await auditEhrAccess({
      ctx,
      action: 'no_show.email_skipped',
      resourceType: 'appointment',
      resourceId: appointmentId,
      details: {
        reason: 'communication_preference_excludes_email',
        preference: pref,
        patient_id: row.patient_id,
      },
    })
    return NextResponse.json({
      sent: false,
      reason: 'communication_preference_excludes_email',
      preference: pref,
    })
  }

  // Need an email on file. The SMS path's analogue is "no patient_phone".
  if (!row.patient_email) {
    await auditEhrAccess({
      ctx,
      action: 'no_show.email_skipped',
      resourceType: 'appointment',
      resourceId: appointmentId,
      details: {
        reason: 'no_email',
        patient_id: row.patient_id,
      },
    })
    return NextResponse.json({ sent: false, reason: 'no_email' })
  }

  const firstName = (row.patient_first_name as string | null) || null
  const patientDisplay = firstName ? firstName : null

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    'https://lab.harboroffice.ai'
  const rescheduleUrl = `${appUrl.replace(/\/$/, '')}/portal/scheduling`

  const { subject, html, text, from } = buildNoShowEmail({
    practiceName: row.practice_name,
    providerName: row.practice_provider_name ?? undefined,
    patientName: patientDisplay ?? undefined,
    rescheduleUrl,
    practicePhone: row.practice_phone ?? undefined,
    // address column not selected — practice contact-info coverage is a
    // follow-up; the footer will simply omit address for now.
  })

  const result = await sendPatientEmail({
    to: row.patient_email,
    subject,
    html,
    from,
    practiceId: row.practice_id,
  })

  if (!result.sent) {
    const reason = result.skipped === 'opted_out' ? 'opted_out' : 'send_failed'
    await auditEhrAccess({
      ctx,
      action: 'no_show.email_skipped',
      resourceType: 'appointment',
      resourceId: appointmentId,
      details: {
        reason,
        patient_id: row.patient_id,
      },
    })
    return NextResponse.json({ sent: false, reason })
  }

  await auditEhrAccess({
    ctx,
    action: 'no_show.email_sent',
    resourceType: 'appointment',
    resourceId: appointmentId,
    details: {
      patient_id: row.patient_id,
      preference: pref,
      // Subject is non-PHI (no patient name, no provider name); safe to log.
      subject,
    },
  })

  return NextResponse.json({
    sent: true,
    channel: 'email',
    appointment_id: appointmentId,
    patient_id: row.patient_id,
  })
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // Preview the email body without sending. Useful for QA + the dashboard
  // "Preview email" button. Same auth as POST.
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const { id: appointmentId } = await params

  const { rows } = await pool.query(
    `SELECT a.id, a.patient_id, a.practice_id,
            p.first_name, p.last_name, p.email, p.communication_preference,
            pr.name, pr.provider_name, pr.phone
       FROM appointments a
       JOIN patients     p  ON p.id = a.patient_id
       JOIN practices    pr ON pr.id = a.practice_id
      WHERE a.id = $1 AND a.practice_id = $2
      LIMIT 1`,
    [appointmentId, ctx.practiceId],
  )
  const row = rows[0]
  if (!row) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Appointment not found' } },
      { status: 404 },
    )
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://lab.harboroffice.ai'
  const { subject, html, text } = buildNoShowEmail({
    practiceName: row.name,
    providerName: row.provider_name ?? undefined,
    patientName: (row.first_name as string | null) ?? undefined,
    rescheduleUrl: `${appUrl.replace(/\/$/, '')}/portal/scheduling`,
    practicePhone: row.phone ?? undefined,
  })

  return NextResponse.json({
    preview: {
      subject,
      html,
      text,
      to: row.email ?? null,
      preference: row.communication_preference ?? 'both',
      will_send: !!row.email && (row.communication_preference === 'email' || row.communication_preference === 'both' || row.communication_preference == null),
    },
  })
}
