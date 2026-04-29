// Wave 50 — high-level transactional-email helpers.
//
// These wrap sendTransactionalEmail() with one signature per use case so
// call sites stay readable. Any new operational email Harbor sends
// should land here, with a corresponding entry in EMAIL_TEMPLATES, rather
// than going straight to sendViaSes().
//
// Suppression checks, preference checks, audit logging, and email_send_log
// inserts are handled by sendTransactionalEmail. Callers only need to
// supply the recipient + the template variables.

import { sendTransactionalEmail, type TransactionalSendResult } from './ses'

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ||
  process.env.APP_URL ||
  'https://harborreceptionist.com'

function appHref(path: string): string {
  const base = APP_URL.replace(/\/$/, '')
  return `${base}${path.startsWith('/') ? path : `/${path}`}`
}

// ─── Appointments ────────────────────────────────────────────────────────

export async function sendAppointmentReminder24h(args: {
  practiceId: string | null
  patientEmail: string
  patientFirstName: string
  providerName: string
  appointmentDateLong: string
  appointmentTime: string
  practiceTimezone: string
  appointmentLocation: string
  recipientPatientId?: string | null
}): Promise<TransactionalSendResult> {
  return sendTransactionalEmail({
    to: args.patientEmail,
    template: 'appointment-reminder-24h',
    practice_id: args.practiceId,
    audit_event_type: 'email.appointment_reminder.24h',
    recipient_patient_id: args.recipientPatientId ?? null,
    variables: {
      patientFirstName: args.patientFirstName,
      providerName: args.providerName,
      appointmentDateLong: args.appointmentDateLong,
      appointmentTime: args.appointmentTime,
      practiceTimezone: args.practiceTimezone,
      appointmentLocation: args.appointmentLocation,
    },
  })
}

export async function sendAppointmentReminder2h(args: {
  practiceId: string | null
  patientEmail: string
  patientFirstName: string
  providerName: string
  appointmentTime: string
  appointmentLocation: string
  recipientPatientId?: string | null
}): Promise<TransactionalSendResult> {
  return sendTransactionalEmail({
    to: args.patientEmail,
    template: 'appointment-reminder-2h',
    practice_id: args.practiceId,
    audit_event_type: 'email.appointment_reminder.2h',
    recipient_patient_id: args.recipientPatientId ?? null,
    variables: {
      patientFirstName: args.patientFirstName,
      providerName: args.providerName,
      appointmentTime: args.appointmentTime,
      appointmentLocation: args.appointmentLocation,
    },
  })
}

export async function sendAppointmentConfirmation(args: {
  practiceId: string | null
  patientEmail: string
  patientFirstName: string
  providerName: string
  appointmentDateLong: string
  appointmentTime: string
  appointmentLocation: string
}): Promise<TransactionalSendResult> {
  return sendTransactionalEmail({
    to: args.patientEmail,
    template: 'appointment-confirmation',
    practice_id: args.practiceId,
    audit_event_type: 'email.appointment_confirmation',
    variables: {
      patientFirstName: args.patientFirstName,
      providerName: args.providerName,
      appointmentDateLong: args.appointmentDateLong,
      appointmentTime: args.appointmentTime,
      appointmentLocation: args.appointmentLocation,
    },
  })
}

export async function sendAppointmentCancellation(args: {
  practiceId: string | null
  patientEmail: string
  patientFirstName: string
  providerName: string
  appointmentDateLong: string
  appointmentTime: string
  cancellationReason: string
  rescheduleUrl?: string
}): Promise<TransactionalSendResult> {
  return sendTransactionalEmail({
    to: args.patientEmail,
    template: 'appointment-cancellation',
    practice_id: args.practiceId,
    audit_event_type: 'email.appointment_cancellation',
    variables: {
      patientFirstName: args.patientFirstName,
      providerName: args.providerName,
      appointmentDateLong: args.appointmentDateLong,
      appointmentTime: args.appointmentTime,
      cancellationReason:
        args.cancellationReason || 'No additional details were provided.',
      rescheduleUrl: args.rescheduleUrl ?? appHref('/portal/schedule'),
    },
  })
}

// ─── Intake / forms ──────────────────────────────────────────────────────

export async function sendIntakeInvitation(args: {
  practiceId: string
  patientEmail: string
  patientFirstName: string
  providerName?: string
  intakeToken: string
  expiryDays?: number
}): Promise<TransactionalSendResult> {
  return sendTransactionalEmail({
    to: args.patientEmail,
    template: 'intake-form-invitation',
    practice_id: args.practiceId,
    audit_event_type: 'email.intake_invitation',
    variables: {
      patientFirstName: args.patientFirstName,
      providerName: args.providerName ?? 'your provider',
      intakeUrl: appHref(`/portal/forms/${args.intakeToken}`),
      intakeExpiryDays: args.expiryDays ?? 14,
    },
  })
}

export async function sendCustomFormInvitation(args: {
  practiceId: string
  patientEmail: string
  patientFirstName: string
  providerName: string
  formName: string
  formToken: string
  expiryDays?: number
}): Promise<TransactionalSendResult> {
  return sendTransactionalEmail({
    to: args.patientEmail,
    template: 'custom-form-invitation',
    practice_id: args.practiceId,
    audit_event_type: 'email.custom_form_invitation',
    variables: {
      patientFirstName: args.patientFirstName,
      providerName: args.providerName,
      formName: args.formName,
      formUrl: appHref(`/portal/custom-forms/${args.formToken}`),
      formExpiryDays: args.expiryDays ?? 14,
    },
  })
}

// ─── Account / auth ──────────────────────────────────────────────────────

export async function sendPasswordResetEmail(args: {
  practiceId: string | null
  recipientEmail: string
  recipientFirstName: string
  resetCode: string
  codeExpiryMinutes?: number
}): Promise<TransactionalSendResult> {
  return sendTransactionalEmail({
    to: args.recipientEmail,
    template: 'password-reset',
    practice_id: args.practiceId,
    audit_event_type: 'email.password_reset',
    variables: {
      recipientFirstName: args.recipientFirstName,
      resetCode: args.resetCode,
      codeExpiryMinutes: args.codeExpiryMinutes ?? 30,
    },
  })
}

export async function sendAccountCreationEmail(args: {
  practiceId: string | null
  recipientEmail: string
  recipientFirstName: string
  signInUrl?: string
}): Promise<TransactionalSendResult> {
  return sendTransactionalEmail({
    to: args.recipientEmail,
    template: 'account-creation',
    practice_id: args.practiceId,
    audit_event_type: 'email.account_creation',
    variables: {
      recipientFirstName: args.recipientFirstName,
      signInUrl: args.signInUrl ?? appHref('/login'),
      helpUrl: appHref('/help'),
    },
  })
}

// ─── Billing ─────────────────────────────────────────────────────────────

export async function sendPaymentReceipt(args: {
  practiceId: string
  patientEmail: string
  patientFirstName: string
  amountFormatted: string
  paymentDate: string
  receiptNumber: string
  paymentMethod: string
  receiptPdfUrl: string
}): Promise<TransactionalSendResult> {
  return sendTransactionalEmail({
    to: args.patientEmail,
    template: 'payment-receipt',
    practice_id: args.practiceId,
    audit_event_type: 'email.payment_receipt',
    variables: {
      patientFirstName: args.patientFirstName,
      amountFormatted: args.amountFormatted,
      paymentDate: args.paymentDate,
      receiptNumber: args.receiptNumber,
      paymentMethod: args.paymentMethod,
      receiptPdfUrl: args.receiptPdfUrl,
    },
  })
}

// ─── Operations ──────────────────────────────────────────────────────────

export async function sendCredentialingExpiryWarning(args: {
  practiceId: string
  ownerEmail: string
  therapistName: string
  therapistId: string
  licenseType: string
  licenseState: string
  licenseNumber: string
  expiresAt: string
  daysRemaining: number
}): Promise<TransactionalSendResult> {
  return sendTransactionalEmail({
    to: args.ownerEmail,
    template: 'credentialing-expiry-warning',
    practice_id: args.practiceId,
    audit_event_type: 'email.credentialing_expiry_warning',
    variables: {
      therapistName: args.therapistName,
      licenseType: args.licenseType,
      licenseState: args.licenseState,
      licenseNumber: args.licenseNumber,
      expiresAt: args.expiresAt,
      daysRemaining: args.daysRemaining,
      daysRemainingPlural: args.daysRemaining === 1 ? '' : 's',
      renewalUrl: appHref(
        `/dashboard/settings/therapists/${args.therapistId}/credentials`,
      ),
    },
  })
}
