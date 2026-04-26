// Harbor email — AWS SES (replaces Resend).
//
// Public surface preserved from the legacy Resend version so the six
// existing callers (lib/reminder-email, /api/intake/send, /api/cron/reconcile,
// /api/admin/email-health, /api/health, plus internal callers) are not
// affected.
//
// SES sandbox / IAM caveat: ses:FromAddress is pinned by IAM to a single
// configured value (SES_FROM_ADDRESS). The legacy multi-from convention
// (Chance@/Sales@/Support@) is preserved via Reply-To rather than From,
// so threading routes still survive even though every outbound is sourced
// from the configured SES address.

import { sendViaSes, sesFromAddress } from './aws/ses'
import { isEmailOptedOut } from './email-optout'

// Named addresses kept for callers + email builders. They drop into
// Reply-To headers; the actual SES Source is sesFromAddress() above.
export const EMAIL_CHANCE  = process.env.RESEND_CHANCE_EMAIL  || 'Chance@harborreceptionist.com'
export const EMAIL_SALES   = process.env.RESEND_SALES_EMAIL   || 'Sales@harborreceptionist.com'
export const EMAIL_SUPPORT = process.env.RESEND_SUPPORT_EMAIL || 'Support@harborreceptionist.com'

interface EmailPayload {
  to: string
  subject: string
  html: string
  /** Threading hint — translated to Reply-To since SES pins the Source. */
  from?: string
}

export async function sendEmail(payload: EmailPayload): Promise<boolean> {
  return sendViaSes({
    to: payload.to,
    subject: payload.subject,
    html: payload.html,
    replyTo: payload.from,
  })
}

// Patient-facing email. Use this INSTEAD of sendEmail for any message
// addressed to a patient (intake invites, intake reminders, welcome email,
// bulk practice messages). Skips the send if the recipient is on the
// practice's email opt-out list.
//
// Therapist-facing emails (call summaries, weekly eligibility digest,
// crisis alerts) keep using sendEmail directly — those are operational
// communications, not patient marketing traffic.
export interface PatientEmailPayload extends EmailPayload {
  practiceId: string
}

export async function sendPatientEmail(
  payload: PatientEmailPayload,
): Promise<{ sent: boolean; skipped: 'opted_out' | null }> {
  const optedOut = await isEmailOptedOut(payload.practiceId, payload.to)
  if (optedOut) {
    console.log(`↩️ Skipping patient email to ${payload.to}: opted out of email`)
    return { sent: false, skipped: 'opted_out' }
  }
  const sent = await sendEmail(payload)
  return { sent, skipped: null }
}

// Re-export so admin/email-health and ops scripts can probe SES config.
export { sesFromAddress }

// PHI-free call summary notification — Reply-To Support@.
export function buildCallSummaryEmail(opts: {
  practiceName: string
  crisisDetected?: boolean
}): { subject: string; html: string; from: string } {
  const subject = opts.crisisDetected
    ? '🚨 CRISIS ALERT — New call handled by Ellie'
    : 'New call handled by Ellie'

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://harborreceptionist.com'
  const dashboardLink = `${appUrl}/dashboard/calls`
  const headerBg = opts.crisisDetected ? '#DC3545' : '#0d9488'

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f0; margin: 0; padding: 20px; }
.container { max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
.header { background: ${headerBg}; padding: 24px 32px; color: white; }
.header h1 { margin: 0; font-size: 20px; font-weight: 600; }
.body { padding: 32px; font-size: 15px; line-height: 1.7; color: #333; }
.button { display: inline-block; background: ${headerBg}; color: white !important; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; margin-top: 16px; }
.footer { padding: 20px 32px; background: #f9f9f7; font-size: 12px; color: #999; text-align: center; }
</style></head>
<body>
<div class="container">
  <div class="header"><h1>${opts.crisisDetected ? '🚨' : '📞'} ${subject}</h1></div>
  <div class="body">
    <p>Ellie handled a new call for <strong>${opts.practiceName}</strong>.</p>
    ${opts.crisisDetected ? '<p><strong>⚠️ Crisis keywords were detected. Please review immediately.</strong></p>' : ''}
    <p>Log in to view the full summary and transcript:</p>
    <a href="${dashboardLink}" class="button">View Call Details →</a>
  </div>
  <div class="footer">Sent by Ellie · Harbor AI Receptionist · <a href="https://harborreceptionist.com">harborreceptionist.com</a></div>
</div>
</body></html>`

  return { subject, html, from: EMAIL_SUPPORT }
}

// PHI-free cancellation notification — Reply-To Support@.
export function buildCancellationEmail(opts: {
  practiceName: string
}): { subject: string; html: string; from: string } {
  const subject = 'Cancellation request received'
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://harborreceptionist.com'
  const dashboardLink = `${appUrl}/dashboard/appointments`

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f0; margin: 0; padding: 20px; }
.container { max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
.header { background: #E8A87C; padding: 24px 32px; color: white; }
.header h1 { margin: 0; font-size: 20px; font-weight: 600; }
.body { padding: 32px; font-size: 15px; line-height: 1.7; color: #333; }
.button { display: inline-block; background: #E8A87C; color: white !important; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; margin-top: 16px; }
.footer { padding: 20px 32px; background: #f9f9f7; font-size: 12px; color: #999; text-align: center; }
</style></head>
<body>
<div class="container">
  <div class="header"><h1>📅 Cancellation Request Received</h1></div>
  <div class="body">
    <p>A patient submitted a cancellation request for <strong>${opts.practiceName}</strong>.</p>
    <a href="${dashboardLink}" class="button">View Appointments →</a>
  </div>
  <div class="footer">Sent by Ellie · Harbor AI Receptionist</div>
</div>
</body></html>`

  return { subject, html, from: EMAIL_SUPPORT }
}

// Patient-facing intake form email — Reply-To Support@.
export function buildIntakeEmail(opts: {
  practiceName: string
  providerName?: string
  patientName?: string
  intakeUrl: string
}): { subject: string; html: string; from: string } {
  const subject = `Complete your intake form — ${opts.practiceName}`
  const greeting = opts.patientName ? `Hi ${opts.patientName}` : 'Hi there'
  const provider = opts.providerName || opts.practiceName

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f0; margin: 0; padding: 20px; }
.container { max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
.header { background: #0d9488; padding: 24px 32px; color: white; }
.header h1 { margin: 0; font-size: 20px; font-weight: 600; }
.body { padding: 32px; font-size: 15px; line-height: 1.7; color: #333; }
.cta { text-align: center; margin: 32px 0; }
.button { display: inline-block; background: #0d9488; color: white !important; padding: 14px 36px; border-radius: 10px; text-decoration: none; font-weight: 600; font-size: 16px; }
.note { font-size: 13px; color: #999; margin-top: 24px; }
.footer { padding: 20px 32px; background: #f9f9f7; font-size: 12px; color: #999; text-align: center; }
</style></head>
<body>
<div class="container">
  <div class="header"><h1>📋 Welcome — Intake Form</h1></div>
  <div class="body">
    <p>${greeting},</p>
    <p><strong>${provider}</strong> has sent you a brief intake questionnaire to complete before your first appointment.</p>
    <p>It takes about 2–3 minutes. Your responses go directly to your therapist and help them prepare for your session.</p>
    <div class="cta">
      <a href="${opts.intakeUrl}" class="button">Complete My Intake Form →</a>
    </div>
    <p class="note">This link expires in 7 days. If you have questions, contact your therapist's office directly.</p>
  </div>
  <div class="footer">Sent by Harbor · AI Receptionist for Therapy Practices</div>
</div>
</body></html>`

  return { subject, html, from: EMAIL_SUPPORT }
}
