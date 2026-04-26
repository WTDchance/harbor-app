// app/api/voice/tools/collect-intake-info/route.ts
//
// Wave 27c — Retell tool: persist new-patient intake info collected
// during the call. Upserts a patients row keyed by (practice_id, phone)
// then writes the latest intake fields. Triggers an email-out of the
// intake form is left to the post-call lifecycle (Wave 27d wiring) so
// this route stays fast and idempotent.

import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/aws/db'
import { parseRetellToolCall, toolResult } from '@/lib/aws/voice/auth'

export async function POST(req: NextRequest) {
  const ctx = await parseRetellToolCall(req)
  if (ctx instanceof NextResponse) return ctx
  const { args, practiceId } = ctx as any

  if (!practiceId) {
    return toolResult('I have your information. The therapist will be in touch soon.')
  }

  const fullName = String(args.name || '').trim()
  const phone = typeof args.phone === 'string' ? args.phone : null
  const email = typeof args.email === 'string' ? args.email.trim().toLowerCase() : null
  const insurance = typeof args.insurance === 'string' ? args.insurance : null
  const telehealthPref = typeof args.telehealthPreference === 'string' ? args.telehealthPreference : null
  const reason = typeof args.reason === 'string' ? args.reason : null
  const preferredTimes = typeof args.preferredTimes === 'string' ? args.preferredTimes : null

  const parts = fullName.split(/\s+/).filter(Boolean)
  const firstName = parts[0] || 'Unknown'
  const lastName = parts.slice(1).join(' ') || ''
  const normalizedPhone = phone?.replace(/\D/g, '').slice(-10) || ''

  try {
    let patientId: string | null = null
    if (normalizedPhone.length >= 10) {
      const { rows } = await pool.query(
        `SELECT id FROM patients
          WHERE practice_id = $1 AND phone ILIKE $2 AND deleted_at IS NULL
          LIMIT 1`,
        [practiceId, `%${normalizedPhone}`],
      )
      if (rows[0]) patientId = rows[0].id
    }

    const presenting = reason ? [reason] : []

    if (patientId) {
      await pool.query(
        `UPDATE patients
            SET first_name = COALESCE(NULLIF($1,''), first_name),
                last_name = COALESCE(NULLIF($2,''), last_name),
                phone = COALESCE($3, phone),
                email = COALESCE($4, email),
                insurance_provider = COALESCE($5, insurance_provider),
                telehealth_preference = COALESCE($6, telehealth_preference),
                presenting_concerns = COALESCE($7::text[], presenting_concerns),
                preferred_times = COALESCE($8, preferred_times)
          WHERE id = $9 AND practice_id = $10`,
        [firstName, lastName, phone, email, insurance, telehealthPref,
         presenting.length ? presenting : null, preferredTimes, patientId, practiceId],
      )
    } else {
      const { rows } = await pool.query(
        `INSERT INTO patients
            (practice_id, first_name, last_name, phone, email,
             insurance_provider, telehealth_preference, presenting_concerns,
             patient_status, first_contact_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8::text[], 'inquiry', NOW())
          RETURNING id`,
        [practiceId, firstName, lastName, phone, email,
         insurance, telehealthPref, presenting.length ? presenting : []],
      )
      patientId = rows[0]?.id ?? null
    }

    await pool.query(
      `INSERT INTO tasks (practice_id, type, patient_name, patient_phone, summary, status)
       VALUES ($1, 'intake', $2, $3, $4, 'pending')`,
      [practiceId, fullName, phone,
       `Intake collected by Ellie. Email: ${email || 'none'}. Insurance: ${insurance || 'none'}. Telehealth: ${telehealthPref || 'unspecified'}. Reason: ${reason || 'unspecified'}. Preferred: ${preferredTimes || 'unspecified'}.`],
    )
  } catch (err) {
    console.error('[retell/collect-intake-info]', (err as Error).message)
  }

  return toolResult("Got it. I've saved your information and the therapist will follow up shortly. You'll receive intake paperwork by email.")
}
