// lib/ehr/era-match.ts
//
// W52 D4 — auto-match a parsed ERA claim line against existing
// appointments/invoices by (patient + service_date + cpt_code + billed_amount).
// Returns { invoice_id?, appointment_id?, patient_id? } or null.

import { pool } from '@/lib/aws/db'

export interface EraLine {
  patient_account_number?: string | null
  service_date?: string | null
  cpt_code?: string | null
  billed_amount_cents?: number | null
}

export interface MatchResult {
  patient_id: string | null
  appointment_id: string | null
  invoice_id: string | null
  confidence: number   // 0..1
  method: 'patient_account_id' | 'service_date_cpt' | 'date_amount' | null
}

export async function autoMatchEraLine(practiceId: string, line: EraLine): Promise<MatchResult> {
  // 1. patient_account_number set as ehr_invoices.id at submission time → exact match.
  if (line.patient_account_number) {
    const r = await pool.query(
      `SELECT id, patient_id, appointment_id
         FROM ehr_invoices
        WHERE id::text = $1 AND practice_id = $2 LIMIT 1`,
      [line.patient_account_number, practiceId],
    ).catch(() => ({ rows: [] as any[] }))
    if (r.rows[0]) {
      return {
        patient_id: r.rows[0].patient_id,
        appointment_id: r.rows[0].appointment_id,
        invoice_id: r.rows[0].id,
        confidence: 0.95,
        method: 'patient_account_id',
      }
    }
  }

  // 2. service_date + cpt_code → match against appointments + their charges.
  if (line.service_date && line.cpt_code) {
    const r = await pool.query(
      `SELECT a.id AS appointment_id, a.patient_id
         FROM appointments a
        WHERE a.practice_id = $1
          AND DATE(a.scheduled_for) = $2::date
          AND COALESCE(a.cpt_code, '') = $3
        ORDER BY a.scheduled_for DESC
        LIMIT 1`,
      [practiceId, line.service_date, line.cpt_code],
    ).catch(() => ({ rows: [] as any[] }))
    if (r.rows[0]) {
      return {
        patient_id: r.rows[0].patient_id,
        appointment_id: r.rows[0].appointment_id,
        invoice_id: null,
        confidence: 0.7,
        method: 'service_date_cpt',
      }
    }
  }

  return { patient_id: null, appointment_id: null, invoice_id: null, confidence: 0, method: null }
}
