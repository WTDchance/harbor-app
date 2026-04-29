// Wave 50 — transactional email template registry.
//
// Every transactional email Harbor sends is defined here. Templates are
// rendered server-side with a tiny {{var}} substitution (no Handlebars,
// no Mustache — keep the surface tiny and auditable for a HIPAA app).
//
// Categories map 1:1 to the user-side notification-preference toggles in
// /portal/settings/notifications. Two categories — `account_creation` and
// `password_reset` — are intentionally NOT togglable; the wrapper enforces
// that users can never opt out of these.
//
// Each template includes:
//   - subject       : `{{var}}` substitution, no HTML
//   - htmlBody      : full <!DOCTYPE> ... </html> document (tested in
//                     Gmail / Outlook / Apple Mail). Inline CSS only —
//                     <style> blocks are stripped by Gmail.
//   - textBody      : plaintext fallback (RFC 2822 multipart)
//   - requiredVariables : runtime check; missing vars throw before send.
//
// Branding variables (practiceName, practiceLogoUrl, practiceAddress,
// practicePhone, manageNotificationsUrl) are supplied by the wrapper from
// the practices row + APP_URL — callers don't need to thread them.

export type EmailCategory =
  | 'appointment_reminder'
  | 'appointment_confirmation'
  | 'appointment_cancellation'
  | 'intake_invitation'
  | 'custom_form_invitation'
  | 'password_reset'
  | 'payment_receipt'
  | 'account_creation'
  | 'credentialing_alert'
  | 'audit_critical'

export type EmailTemplate = {
  templateId: string
  category: EmailCategory
  /** PHI risk — when true, the wrapper enforces extra guardrails (HIPAA
   *  notice in footer, no PHI in subject line). All patient-facing
   *  templates are PHI-tier. */
  containsPhi: boolean
  /** When true the template is non-togglable — the wrapper ignores the
   *  user's notification-preference toggle for this category. Used for
   *  account_creation and password_reset. */
  alwaysSend: boolean
  subject: string
  htmlBody: string
  textBody: string
  requiredVariables: string[]
}

// ─── Shared layout helpers ───────────────────────────────────────────────

const BRAND_COLOR = '#0d5c4b'
const BRAND_ACCENT = '#a8d5c8'

function htmlShell(body: string, opts: { containsPhi: boolean }): string {
  // PHI-tier emails get the HIPAA confidentiality notice in the footer.
  const phiNotice = opts.containsPhi
    ? `<p style="color:#9ca3af;font-size:11px;margin:8px 0 0;line-height:1.5">
         <strong>Confidentiality notice:</strong> This message may contain
         protected health information (PHI). If you received this in error,
         please delete it and notify the sender. Do not forward.
       </p>`
    : ''

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{{practiceName}}</title></head>
<body style="margin:0;padding:0;background:#f5f5f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1f2937">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f5f0;padding:20px 0">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06)">
        <tr><td style="background:${BRAND_COLOR};padding:24px 32px">
          <h1 style="color:#ffffff;margin:0;font-size:20px;font-weight:600">{{practiceName}}</h1>
          <p style="color:${BRAND_ACCENT};margin:4px 0 0;font-size:13px">{{__headerSubtitle}}</p>
        </td></tr>
        <tr><td style="padding:32px;font-size:15px;line-height:1.6;color:#374151">
          ${body}
        </td></tr>
        <tr><td style="padding:18px 32px;background:#f9fafb;border-top:1px solid #e5e7eb">
          <p style="color:#6b7280;font-size:12px;margin:0;font-weight:600">{{practiceName}}</p>
          <p style="color:#6b7280;font-size:12px;margin:2px 0 0">{{practiceAddress}}</p>
          <p style="color:#6b7280;font-size:12px;margin:2px 0 0">{{practicePhone}}</p>
          <p style="color:#9ca3af;font-size:11px;margin:10px 0 0;line-height:1.5">
            <a href="{{manageNotificationsUrl}}" style="color:#6b7280;text-decoration:underline">Manage notification preferences</a>
            &nbsp;·&nbsp;
            Sent by Harbor on behalf of {{practiceName}}
          </p>
          ${phiNotice}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`
}

// ─── Templates ───────────────────────────────────────────────────────────

const APPOINTMENT_REMINDER_24H: EmailTemplate = {
  templateId: 'appointment-reminder-24h',
  category: 'appointment_reminder',
  containsPhi: true,
  alwaysSend: false,
  subject: 'Reminder: your appointment with {{providerName}} tomorrow',
  htmlBody: htmlShell(
    `<p>Hi {{patientFirstName}},</p>
     <p>This is a friendly reminder that you have an appointment with <strong>{{providerName}}</strong> tomorrow.</p>
     <div style="background:#f0f7f4;border-left:4px solid ${BRAND_COLOR};padding:16px;margin:20px 0;border-radius:4px">
       <strong style="color:${BRAND_COLOR};font-size:16px">{{appointmentDateLong}}</strong><br/>
       <span style="color:#374151">{{appointmentTime}} ({{practiceTimezone}})</span><br/>
       <span style="color:#6b7280;font-size:14px">{{appointmentLocation}}</span>
     </div>
     <p>Need to reschedule or cancel? Please call us at <a href="tel:{{practicePhone}}" style="color:${BRAND_COLOR}">{{practicePhone}}</a> as soon as possible.</p>
     <p>We look forward to seeing you.</p>`,
    { containsPhi: true },
  ),
  textBody: `Hi {{patientFirstName}},

This is a friendly reminder that you have an appointment with {{providerName}} tomorrow.

  {{appointmentDateLong}}
  {{appointmentTime}} ({{practiceTimezone}})
  {{appointmentLocation}}

Need to reschedule or cancel? Please call us at {{practicePhone}}.

— {{practiceName}}

Manage your email preferences: {{manageNotificationsUrl}}`,
  requiredVariables: [
    'patientFirstName', 'providerName', 'appointmentDateLong',
    'appointmentTime', 'practiceTimezone', 'appointmentLocation',
  ],
}

const APPOINTMENT_REMINDER_2H: EmailTemplate = {
  templateId: 'appointment-reminder-2h',
  category: 'appointment_reminder',
  containsPhi: true,
  alwaysSend: false,
  subject: 'Heads up: your appointment is in 2 hours',
  htmlBody: htmlShell(
    `<p>Hi {{patientFirstName}},</p>
     <p>Just a quick heads up — your appointment with <strong>{{providerName}}</strong> is in about 2 hours.</p>
     <div style="background:#f0f7f4;border-left:4px solid ${BRAND_COLOR};padding:16px;margin:20px 0;border-radius:4px">
       <strong style="color:${BRAND_COLOR};font-size:16px">Today at {{appointmentTime}}</strong><br/>
       <span style="color:#6b7280;font-size:14px">{{appointmentLocation}}</span>
     </div>
     <p>If anything has come up, please call us at <a href="tel:{{practicePhone}}" style="color:${BRAND_COLOR}">{{practicePhone}}</a>.</p>
     <p>See you soon.</p>`,
    { containsPhi: true },
  ),
  textBody: `Hi {{patientFirstName}},

Quick heads up — your appointment with {{providerName}} is in about 2 hours.

  Today at {{appointmentTime}}
  {{appointmentLocation}}

If anything has come up, please call us at {{practicePhone}}.

— {{practiceName}}`,
  requiredVariables: [
    'patientFirstName', 'providerName', 'appointmentTime',
    'appointmentLocation',
  ],
}

const APPOINTMENT_CONFIRMATION: EmailTemplate = {
  templateId: 'appointment-confirmation',
  category: 'appointment_confirmation',
  containsPhi: true,
  alwaysSend: false,
  subject: 'Appointment confirmed: {{appointmentDateLong}}',
  htmlBody: htmlShell(
    `<p>Hi {{patientFirstName}},</p>
     <p>Your appointment is confirmed:</p>
     <div style="background:#f0f7f4;border-left:4px solid ${BRAND_COLOR};padding:16px;margin:20px 0;border-radius:4px">
       <strong style="color:${BRAND_COLOR};font-size:16px">{{appointmentDateLong}} at {{appointmentTime}}</strong><br/>
       <span style="color:#374151">with {{providerName}}</span><br/>
       <span style="color:#6b7280;font-size:14px">{{appointmentLocation}}</span>
     </div>
     <p>You'll receive a reminder 24 hours before. Need to make a change? Call <a href="tel:{{practicePhone}}" style="color:${BRAND_COLOR}">{{practicePhone}}</a>.</p>
     <p>Looking forward to it.</p>`,
    { containsPhi: true },
  ),
  textBody: `Hi {{patientFirstName}},

Your appointment is confirmed:

  {{appointmentDateLong}} at {{appointmentTime}}
  with {{providerName}}
  {{appointmentLocation}}

You'll receive a reminder 24 hours before. Need to make a change? Call {{practicePhone}}.

— {{practiceName}}`,
  requiredVariables: [
    'patientFirstName', 'providerName', 'appointmentDateLong',
    'appointmentTime', 'appointmentLocation',
  ],
}

const APPOINTMENT_CANCELLATION: EmailTemplate = {
  templateId: 'appointment-cancellation',
  category: 'appointment_cancellation',
  containsPhi: true,
  alwaysSend: false,
  subject: 'Appointment cancelled: {{appointmentDateLong}}',
  htmlBody: htmlShell(
    `<p>Hi {{patientFirstName}},</p>
     <p>Your appointment on <strong>{{appointmentDateLong}} at {{appointmentTime}}</strong> with {{providerName}} has been cancelled.</p>
     <p>{{cancellationReason}}</p>
     <p>To rebook, please call <a href="tel:{{practicePhone}}" style="color:${BRAND_COLOR}">{{practicePhone}}</a> or visit our <a href="{{rescheduleUrl}}" style="color:${BRAND_COLOR}">scheduling page</a>.</p>`,
    { containsPhi: true },
  ),
  textBody: `Hi {{patientFirstName}},

Your appointment on {{appointmentDateLong}} at {{appointmentTime}} with {{providerName}} has been cancelled.

{{cancellationReason}}

To rebook, call {{practicePhone}} or visit {{rescheduleUrl}}.

— {{practiceName}}`,
  requiredVariables: [
    'patientFirstName', 'providerName', 'appointmentDateLong',
    'appointmentTime', 'cancellationReason', 'rescheduleUrl',
  ],
}

const INTAKE_INVITATION: EmailTemplate = {
  templateId: 'intake-form-invitation',
  category: 'intake_invitation',
  containsPhi: true,
  alwaysSend: false,
  subject: 'Welcome to {{practiceName}} — please complete your intake',
  htmlBody: htmlShell(
    `<p>Hi {{patientFirstName}},</p>
     <p>Welcome to {{practiceName}}. Before your first appointment with <strong>{{providerName}}</strong>, please take a few minutes to complete your intake forms.</p>
     <div style="text-align:center;margin:28px 0">
       <a href="{{intakeUrl}}" style="display:inline-block;background:${BRAND_COLOR};color:#ffffff;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:600;font-size:15px">Complete intake forms →</a>
     </div>
     <p style="color:#6b7280;font-size:13px">This link expires in {{intakeExpiryDays}} days. If you have trouble accessing it, please call us at <a href="tel:{{practicePhone}}" style="color:${BRAND_COLOR}">{{practicePhone}}</a>.</p>`,
    { containsPhi: true },
  ),
  textBody: `Hi {{patientFirstName}},

Welcome to {{practiceName}}. Before your first appointment with {{providerName}}, please complete your intake forms:

  {{intakeUrl}}

This link expires in {{intakeExpiryDays}} days. If you have trouble, call {{practicePhone}}.

— {{practiceName}}`,
  requiredVariables: [
    'patientFirstName', 'providerName', 'intakeUrl', 'intakeExpiryDays',
  ],
}

const CUSTOM_FORM_INVITATION: EmailTemplate = {
  templateId: 'custom-form-invitation',
  category: 'custom_form_invitation',
  containsPhi: true,
  alwaysSend: false,
  subject: 'Please complete: {{formName}}',
  htmlBody: htmlShell(
    `<p>Hi {{patientFirstName}},</p>
     <p>{{providerName}} has asked you to complete a form: <strong>{{formName}}</strong>.</p>
     <div style="text-align:center;margin:28px 0">
       <a href="{{formUrl}}" style="display:inline-block;background:${BRAND_COLOR};color:#ffffff;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:600;font-size:15px">Complete form →</a>
     </div>
     <p style="color:#6b7280;font-size:13px">This link expires in {{formExpiryDays}} days.</p>`,
    { containsPhi: true },
  ),
  textBody: `Hi {{patientFirstName}},

{{providerName}} has asked you to complete a form: {{formName}}.

Open it here: {{formUrl}}

This link expires in {{formExpiryDays}} days.

— {{practiceName}}`,
  requiredVariables: [
    'patientFirstName', 'providerName', 'formName', 'formUrl', 'formExpiryDays',
  ],
}

const PASSWORD_RESET: EmailTemplate = {
  templateId: 'password-reset',
  category: 'password_reset',
  containsPhi: false,
  alwaysSend: true, // never opt-out-able
  subject: 'Your {{practiceName}} password reset code',
  htmlBody: htmlShell(
    `<p>Hi {{recipientFirstName}},</p>
     <p>Use this code to reset your password:</p>
     <div style="background:#f0f7f4;border-left:4px solid ${BRAND_COLOR};padding:20px;margin:20px 0;border-radius:4px;text-align:center">
       <span style="font-family:'SF Mono',Menlo,Consolas,monospace;font-size:32px;font-weight:600;color:${BRAND_COLOR};letter-spacing:4px">{{resetCode}}</span>
     </div>
     <p style="color:#6b7280;font-size:13px">This code expires in {{codeExpiryMinutes}} minutes. If you didn't request a password reset, you can safely ignore this email.</p>`,
    { containsPhi: false },
  ),
  textBody: `Hi {{recipientFirstName}},

Use this code to reset your password:

  {{resetCode}}

This code expires in {{codeExpiryMinutes}} minutes. If you didn't request a reset, you can ignore this email.

— {{practiceName}}`,
  requiredVariables: ['recipientFirstName', 'resetCode', 'codeExpiryMinutes'],
}

const PAYMENT_RECEIPT: EmailTemplate = {
  templateId: 'payment-receipt',
  category: 'payment_receipt',
  containsPhi: false,
  alwaysSend: false,
  subject: 'Receipt for your payment to {{practiceName}}',
  htmlBody: htmlShell(
    `<p>Hi {{patientFirstName}},</p>
     <p>Thank you. Your payment of <strong>{{amountFormatted}}</strong> on {{paymentDate}} has been received.</p>
     <div style="background:#f0f7f4;border-left:4px solid ${BRAND_COLOR};padding:16px;margin:20px 0;border-radius:4px">
       <strong style="color:${BRAND_COLOR}">Receipt #{{receiptNumber}}</strong><br/>
       <span style="color:#374151">Amount: {{amountFormatted}}</span><br/>
       <span style="color:#374151">Date: {{paymentDate}}</span><br/>
       <span style="color:#374151">Payment method: {{paymentMethod}}</span>
     </div>
     <div style="text-align:center;margin:24px 0">
       <a href="{{receiptPdfUrl}}" style="display:inline-block;background:${BRAND_COLOR};color:#ffffff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600">Download receipt (PDF) →</a>
     </div>`,
    { containsPhi: false },
  ),
  textBody: `Hi {{patientFirstName}},

Thank you. Your payment of {{amountFormatted}} on {{paymentDate}} has been received.

  Receipt #{{receiptNumber}}
  Amount: {{amountFormatted}}
  Date: {{paymentDate}}
  Payment method: {{paymentMethod}}

PDF receipt: {{receiptPdfUrl}}

— {{practiceName}}`,
  requiredVariables: [
    'patientFirstName', 'amountFormatted', 'paymentDate',
    'receiptNumber', 'paymentMethod', 'receiptPdfUrl',
  ],
}

const ACCOUNT_CREATION: EmailTemplate = {
  templateId: 'account-creation',
  category: 'account_creation',
  containsPhi: false,
  alwaysSend: true, // never opt-out-able
  subject: 'Welcome to Harbor — your practice is ready',
  htmlBody: htmlShell(
    `<p>Hi {{recipientFirstName}},</p>
     <p>Your Harbor account for <strong>{{practiceName}}</strong> is ready.</p>
     <p>Use the link below to sign in for the first time. You'll be asked to set a password.</p>
     <div style="text-align:center;margin:28px 0">
       <a href="{{signInUrl}}" style="display:inline-block;background:${BRAND_COLOR};color:#ffffff;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:600;font-size:15px">Sign in →</a>
     </div>
     <p>Need help getting set up? Reply to this email or visit our <a href="{{helpUrl}}" style="color:${BRAND_COLOR}">help center</a>.</p>`,
    { containsPhi: false },
  ),
  textBody: `Hi {{recipientFirstName}},

Your Harbor account for {{practiceName}} is ready.

Sign in: {{signInUrl}}

Help center: {{helpUrl}}

— Harbor`,
  requiredVariables: ['recipientFirstName', 'signInUrl', 'helpUrl'],
}

const CREDENTIALING_EXPIRY_WARNING: EmailTemplate = {
  templateId: 'credentialing-expiry-warning',
  category: 'credentialing_alert',
  containsPhi: false,
  alwaysSend: false,
  subject: 'License expiring in {{daysRemaining}} days — {{therapistName}}',
  htmlBody: htmlShell(
    `<p>Heads up — <strong>{{therapistName}}</strong>'s {{licenseType}} license in {{licenseState}} (#{{licenseNumber}}) expires on <strong>{{expiresAt}}</strong> ({{daysRemaining}} day{{daysRemainingPlural}} from now).</p>
     <p>Renewal reminders are sent at the 60, 30, and 7-day marks. After expiry, the therapist will be blocked from billable work until the renewal is recorded.</p>
     <div style="text-align:center;margin:24px 0">
       <a href="{{renewalUrl}}" style="display:inline-block;background:${BRAND_COLOR};color:#ffffff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600">Renew or update license →</a>
     </div>`,
    { containsPhi: false },
  ),
  textBody: `Heads up — {{therapistName}}'s {{licenseType}} license in {{licenseState}} (#{{licenseNumber}}) expires on {{expiresAt}} ({{daysRemaining}} days).

Renew: {{renewalUrl}}

— Harbor`,
  requiredVariables: [
    'therapistName', 'licenseType', 'licenseState', 'licenseNumber',
    'expiresAt', 'daysRemaining', 'daysRemainingPlural', 'renewalUrl',
  ],
}

// ─── Registry ────────────────────────────────────────────────────────────

export const EMAIL_TEMPLATES = {
  'appointment-reminder-24h': APPOINTMENT_REMINDER_24H,
  'appointment-reminder-2h': APPOINTMENT_REMINDER_2H,
  'appointment-confirmation': APPOINTMENT_CONFIRMATION,
  'appointment-cancellation': APPOINTMENT_CANCELLATION,
  'intake-form-invitation': INTAKE_INVITATION,
  'custom-form-invitation': CUSTOM_FORM_INVITATION,
  'password-reset': PASSWORD_RESET,
  'payment-receipt': PAYMENT_RECEIPT,
  'account-creation': ACCOUNT_CREATION,
  'credentialing-expiry-warning': CREDENTIALING_EXPIRY_WARNING,
} as const satisfies Record<string, EmailTemplate>

export type TemplateId = keyof typeof EMAIL_TEMPLATES

export function getTemplate(id: TemplateId): EmailTemplate {
  const t = EMAIL_TEMPLATES[id]
  if (!t) throw new Error(`Unknown email template: ${id}`)
  return t
}

// Map a template's category to the column on users/patients that toggles
// it. account_creation + password_reset return null (always-send).
export function preferenceColumnFor(
  category: EmailCategory,
): string | null {
  switch (category) {
    case 'appointment_reminder':       return 'appointment_reminders_enabled'
    case 'appointment_confirmation':   return 'appointment_reminders_enabled'
    case 'appointment_cancellation':   return 'appointment_reminders_enabled'
    case 'intake_invitation':          return 'intake_invitations_enabled'
    case 'custom_form_invitation':     return 'custom_form_invitations_enabled'
    case 'payment_receipt':            return 'payment_receipts_enabled'
    case 'credentialing_alert':        return 'credentialing_alerts_enabled'
    case 'audit_critical':             return null // ops alerts always send
    case 'password_reset':             return null
    case 'account_creation':           return null
  }
}

// ─── Substitution ────────────────────────────────────────────────────────

const VAR_REGEX = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g

/**
 * Replace `{{var}}` placeholders with values from `vars`. Missing values
 * become an empty string — required-variable enforcement runs separately
 * in renderTemplate() so callers see a clear error.
 */
export function substitute(
  template: string,
  vars: Record<string, string | number | undefined | null>,
): string {
  return template.replace(VAR_REGEX, (_m, key) => {
    const v = vars[key]
    if (v === undefined || v === null) return ''
    return String(v)
  })
}

export type RenderedEmail = {
  subject: string
  html: string
  text: string
}

/**
 * Validate required variables are present, then substitute. Throws if
 * any required var is missing (callers should treat this as a programmer
 * bug, not a runtime fault — we'd rather refuse to send than send a
 * broken template).
 */
export function renderTemplate(
  templateId: TemplateId,
  vars: Record<string, string | number | undefined | null>,
  branding: {
    practiceName: string
    practiceAddress: string
    practicePhone: string
    manageNotificationsUrl: string
    headerSubtitle?: string
  },
): RenderedEmail {
  const t = getTemplate(templateId)
  const missing = t.requiredVariables.filter(
    k => vars[k] === undefined || vars[k] === null || vars[k] === '',
  )
  if (missing.length > 0) {
    throw new Error(
      `Template ${templateId} missing required variables: ${missing.join(', ')}`,
    )
  }
  const merged: Record<string, string | number | undefined | null> = {
    ...vars,
    practiceName: branding.practiceName,
    practiceAddress: branding.practiceAddress,
    practicePhone: branding.practicePhone,
    manageNotificationsUrl: branding.manageNotificationsUrl,
    __headerSubtitle: branding.headerSubtitle ?? defaultHeaderSubtitle(t.category),
  }
  return {
    subject: substitute(t.subject, merged),
    html: substitute(t.htmlBody, merged),
    text: substitute(t.textBody, merged),
  }
}

function defaultHeaderSubtitle(category: EmailCategory): string {
  switch (category) {
    case 'appointment_reminder':     return 'Appointment reminder'
    case 'appointment_confirmation': return 'Appointment confirmed'
    case 'appointment_cancellation': return 'Appointment cancelled'
    case 'intake_invitation':        return 'Welcome'
    case 'custom_form_invitation':   return 'Form to complete'
    case 'password_reset':           return 'Password reset'
    case 'payment_receipt':          return 'Payment receipt'
    case 'account_creation':         return 'Account ready'
    case 'credentialing_alert':      return 'License renewal'
    case 'audit_critical':           return 'Action required'
  }
}
