// lib/aws/ehr/authorizations.ts
//
// Wave 40 / P1 — helper for finding the active insurance auth that
// applies to an appointment, consuming a session, and computing the
// warning state.
//
// Intentionally pure-DB (no audit calls inside) — callers decide
// when to fire audit_logs entries so we keep the audit shape close
// to the route's intent (e.g. consumption from an appointment POST
// is logged as `insurance_authorization.used` with the appointment
// id in details).

import type { PoolClient } from 'pg'
import { pool } from '@/lib/aws/db'

export type AuthWarning = 'low' | 'expired' | 'exhausted' | null

export interface InsuranceAuth {
  id: string
  patient_id: string
  practice_id: string
  payer: string
  auth_number: string
  sessions_authorized: number
  sessions_used: number
  valid_from: string | null
  valid_to: string | null
  cpt_codes_covered: string[]
  status: 'active' | 'expired' | 'exhausted' | 'superseded'
  notes: string | null
}

export interface CheckAuthResult {
  auth: InsuranceAuth | null
  /** Warning set when sessions_used would meet/exceed authorized-2,
   *  or scheduled_for is past valid_to, or the auth is already
   *  exhausted. Null when everything is fine. */
  warning: AuthWarning
  /** Human-readable copy the UI can show inline. */
  message: string | null
}

const LOW_THRESHOLD = 2

function dateOnly(iso: string): string {
  // accept either a YYYY-MM-DD string or a full ISO timestamp.
  return iso.length >= 10 ? iso.slice(0, 10) : iso
}

/**
 * Find an active auth for the given (patient, cpt, scheduled_for) tuple.
 * - Patient + practice scoped.
 * - status='active'.
 * - cpt_codes_covered empty OR contains the CPT.
 * - valid_from null or <= scheduled_for.
 * - valid_to null or scheduled_for <= valid_to + grace (we still match
 *   expired auths so the warning surfaces — caller decides to block).
 *
 * Returns the most recently created match (renewals supersede older auths).
 */
export async function findActiveAuth(args: {
  client?: PoolClient
  practiceId: string
  patientId: string
  cptCode: string | null
  scheduledFor: string
}): Promise<InsuranceAuth | null> {
  const cpt = args.cptCode ?? null
  const date = dateOnly(args.scheduledFor)
  const q = (args.client ?? pool).query.bind(args.client ?? pool)
  const { rows } = await q(
    `SELECT id, patient_id, practice_id, payer, auth_number,
            sessions_authorized, sessions_used,
            valid_from::text AS valid_from, valid_to::text AS valid_to,
            cpt_codes_covered, status, notes
       FROM ehr_insurance_authorizations
      WHERE practice_id = $1
        AND patient_id  = $2
        AND status      = 'active'
        AND (valid_from IS NULL OR valid_from <= $3::date)
        AND (
              cardinality(cpt_codes_covered) = 0
              OR ($4::text IS NOT NULL AND $4::text = ANY (cpt_codes_covered))
            )
      ORDER BY created_at DESC
      LIMIT 1`,
    [args.practiceId, args.patientId, date, cpt],
  ) as { rows: InsuranceAuth[] }
  return rows[0] ?? null
}

/**
 * Compute the warning state given an auth + a candidate scheduled_for.
 * Pure function — does not write to the DB.
 */
export function computeWarning(
  auth: InsuranceAuth | null,
  scheduledFor: string,
): { warning: AuthWarning; message: string | null } {
  if (!auth) return { warning: null, message: null }
  const date = dateOnly(scheduledFor)
  if (auth.valid_to && date > auth.valid_to) {
    return {
      warning: 'expired',
      message:
        `Authorization ${auth.auth_number} expired on ${auth.valid_to}. ` +
        `Schedule a renewal before billing this session.`,
    }
  }
  if (auth.sessions_used >= auth.sessions_authorized) {
    return {
      warning: 'exhausted',
      message:
        `Authorization ${auth.auth_number} is exhausted ` +
        `(${auth.sessions_used} of ${auth.sessions_authorized} used).`,
    }
  }
  if (auth.sessions_used + 1 >= auth.sessions_authorized - LOW_THRESHOLD + 1) {
    // sessions_remaining_after_this <= 1 → low
    const remaining = auth.sessions_authorized - auth.sessions_used
    return {
      warning: 'low',
      message:
        `Authorization ${auth.auth_number} has ${remaining} session(s) ` +
        `remaining. Request a renewal before booking further appointments.`,
    }
  }
  return { warning: null, message: null }
}

/**
 * Consume a single session against an auth. Idempotent at the call site
 * via the appointment id — we do NOT enforce uniqueness in the DB to
 * avoid coupling the schema to appointment scheduling, but callers
 * should not call this twice for the same appointment unless they
 * intend a double-consume.
 *
 * Sets status='exhausted' on the row when sessions_used reaches
 * sessions_authorized as a side effect.
 */
export async function consumeAuthSession(args: {
  client?: PoolClient
  authId: string
}): Promise<InsuranceAuth | null> {
  const q = (args.client ?? pool).query.bind(args.client ?? pool)
  const upd = await q(
    `UPDATE ehr_insurance_authorizations
        SET sessions_used = sessions_used + 1,
            status = CASE
                       WHEN sessions_used + 1 >= sessions_authorized
                       THEN 'exhausted'
                       ELSE status
                     END
      WHERE id = $1 AND status = 'active'
      RETURNING id, patient_id, practice_id, payer, auth_number,
                sessions_authorized, sessions_used,
                valid_from::text AS valid_from, valid_to::text AS valid_to,
                cpt_codes_covered, status, notes`,
    [args.authId],
  ) as { rows: InsuranceAuth[] }
  return upd.rows[0] ?? null
}

/**
 * Inverse of consumeAuthSession — used when an appointment that
 * consumed a session is cancelled. Refuses to take sessions_used
 * below zero.
 */
export async function releaseAuthSession(args: {
  client?: PoolClient
  authId: string
}): Promise<InsuranceAuth | null> {
  const q = (args.client ?? pool).query.bind(args.client ?? pool)
  const upd = await q(
    `UPDATE ehr_insurance_authorizations
        SET sessions_used = GREATEST(sessions_used - 1, 0),
            status = CASE
                       WHEN status = 'exhausted'
                            AND sessions_used - 1 < sessions_authorized
                       THEN 'active'
                       ELSE status
                     END
      WHERE id = $1
      RETURNING id, patient_id, practice_id, payer, auth_number,
                sessions_authorized, sessions_used,
                valid_from::text AS valid_from, valid_to::text AS valid_to,
                cpt_codes_covered, status, notes`,
    [args.authId],
  ) as { rows: InsuranceAuth[] }
  return upd.rows[0] ?? null
}
