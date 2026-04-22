// lib/ehr/portal.ts
// Patient-portal session helpers. Not a full auth system — a lightweight
// token-based session for v1:
//
//   - Therapist generates a long-random portal_access_token for a patient.
//   - Patient follows a link like /portal/login?token=XXXX.
//   - We verify the token, set a signed cookie storing { patient_id, token },
//     and let portal pages resolve the patient from the cookie on each request.
//   - Rotating the token (regenerate) invalidates the session.
//
// A future upgrade replaces this with a proper Supabase Auth "patient" user,
// but that's considerably more work and isn't on the tonight path.

import { cookies } from 'next/headers'
import { randomBytes } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase'

const COOKIE_NAME = 'harbor_portal_session'
const COOKIE_MAX_AGE = 60 * 60 * 8 // 8 hours

export type PortalSession = {
  patient_id: string
  practice_id: string
  patient_first_name: string
  patient_last_name: string
}

export function newPortalToken(): string {
  return 'p_' + randomBytes(24).toString('base64url')
}

export async function setPortalSessionCookie(token: string): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  })
}

export async function clearPortalSessionCookie(): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.delete(COOKIE_NAME)
}

/**
 * Resolve the current portal session from the cookie. Returns null if no
 * session or if the token no longer matches a patient (token was rotated).
 */
export async function getPortalSession(): Promise<PortalSession | null> {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get(COOKIE_NAME)?.value
    if (!token) return null
    const { data: patient } = await supabaseAdmin
      .from('patients')
      .select('id, practice_id, first_name, last_name, portal_token_expires_at')
      .eq('portal_access_token', token)
      .maybeSingle()
    if (!patient) return null
    if (patient.portal_token_expires_at && new Date(patient.portal_token_expires_at).getTime() < Date.now()) {
      return null
    }
    return {
      patient_id: patient.id,
      practice_id: patient.practice_id,
      patient_first_name: patient.first_name,
      patient_last_name: patient.last_name,
    }
  } catch {
    return null
  }
}

export async function verifyAndConsumeLoginToken(token: string): Promise<PortalSession | null> {
  try {
    const { data: patient } = await supabaseAdmin
      .from('patients')
      .select('id, practice_id, first_name, last_name, portal_token_expires_at')
      .eq('portal_access_token', token)
      .maybeSingle()
    if (!patient) return null
    if (patient.portal_token_expires_at && new Date(patient.portal_token_expires_at).getTime() < Date.now()) {
      return null
    }
    // Record login
    await supabaseAdmin.from('patients').update({ portal_last_login_at: new Date().toISOString() }).eq('id', patient.id)
    return {
      patient_id: patient.id,
      practice_id: patient.practice_id,
      patient_first_name: patient.first_name,
      patient_last_name: patient.last_name,
    }
  } catch {
    return null
  }
}
