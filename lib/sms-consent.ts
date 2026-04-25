/**
 * SMS consent gate — for appointment-CONTENT messages only.
 *
 * HIPAA requires patient consent (with risk disclosure) before we send PHI
 * via an unencrypted channel like SMS. Appointment reminders that carry
 * therapist name + time ARE PHI. Intake-link SMS that carry only a URL
 * are not PHI in the same way (patient requested the form).
 *
 * This module gives callers a single choke point:
 *   `hasSmsConsent(practiceId, phone)` — returns true if the patient on
 *   record has a non-null `sms_consent_given_at` AND has not opted out.
 *
 * Callers that send appointment-content SMS MUST check this before calling
 * `sendSMS` from `./twilio`. sendSMS itself doesn't enforce this because
 * some legitimate messages (STOP confirmations, intake links) should
 * still go through without a consent record on file.
 *
 * NOTE on pre-launch posture: the practice-side BAA with Twilio gates
 * whether we should be sending PHI-laden SMS at all. This module ONLY
 * enforces patient-side consent. Both must be true for a compliant send.
 */

import { supabaseAdmin } from './supabase'
import { isOptedOut } from './sms-optout'

export interface SmsConsentCheck {
  allowed: boolean
  reason: 'ok' | 'no_consent_on_file' | 'patient_opted_out' | 'patient_not_found' | 'lookup_error'
  patientId: string | null
  consentTextVersion: string | null
  consentGivenAt: string | null
}

/**
 * Check whether we can send appointment-content SMS to this phone for
 * this practice. Returns a structured result so callers can log *why* a
 * send was blocked (useful for debugging and audit).
 */
export async function checkSmsConsent(
  practiceId: string,
  phone: string
): Promise<SmsConsentCheck> {
  if (!phone) {
    return {
      allowed: false,
      reason: 'patient_not_found',
      patientId: null,
      consentTextVersion: null,
      consentGivenAt: null,
    }
  }

  // Check opt-out first — that's always absolute
  try {
    if (await isOptedOut(practiceId, phone)) {
      return {
        allowed: false,
        reason: 'patient_opted_out',
        patientId: null,
        consentTextVersion: null,
        consentGivenAt: null,
      }
    }
  } catch (err) {
    console.warn('[sms-consent] opt-out lookup failed; blocking send', err)
    return {
      allowed: false,
      reason: 'lookup_error',
      patientId: null,
      consentTextVersion: null,
      consentGivenAt: null,
    }
  }

  // Look up the patient record. We match loosely on phone (last-10 digits) to
  // survive formatting differences (+1, dashes, etc.).
  const normalized = phone.replace(/\D/g, '').slice(-10)
  if (normalized.length < 10) {
    return {
      allowed: false,
      reason: 'patient_not_found',
      patientId: null,
      consentTextVersion: null,
      consentGivenAt: null,
    }
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('patients')
      .select('id, sms_consent_given_at, sms_consent_text_version')
      .eq('practice_id', practiceId)
      .ilike('phone', `%${normalized}`)
      .limit(1)
      .maybeSingle()

    if (error) {
      console.warn('[sms-consent] patient lookup failed; blocking send', error)
      return {
        allowed: false,
        reason: 'lookup_error',
        patientId: null,
        consentTextVersion: null,
        consentGivenAt: null,
      }
    }
    if (!data) {
      return {
        allowed: false,
        reason: 'patient_not_found',
        patientId: null,
        consentTextVersion: null,
        consentGivenAt: null,
      }
    }
    if (!data.sms_consent_given_at) {
      return {
        allowed: false,
        reason: 'no_consent_on_file',
        patientId: data.id,
        consentTextVersion: data.sms_consent_text_version ?? null,
        consentGivenAt: null,
      }
    }
    return {
      allowed: true,
      reason: 'ok',
      patientId: data.id,
      consentTextVersion: data.sms_consent_text_version ?? null,
      consentGivenAt: data.sms_consent_given_at,
    }
  } catch (err) {
    console.error('[sms-consent] unexpected error; blocking send', err)
    return {
      allowed: false,
      reason: 'lookup_error',
      patientId: null,
      consentTextVersion: null,
      consentGivenAt: null,
    }
  }
}

/**
 * Convenience boolean form. Use when you only need allow/deny and don't care
 * about the reason.
 */
export async function hasSmsConsent(practiceId: string, phone: string): Promise<boolean> {
  const res = await checkSmsConsent(practiceId, phone)
  return res.allowed
}
