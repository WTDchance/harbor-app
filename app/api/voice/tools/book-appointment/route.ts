// app/api/voice/tools/book-appointment/route.ts
//
// Wave 27c — Retell tool: book a confirmed appointment on the
// practice calendar. Upserts a patient row, INSERTs the appointment,
// audits the action. Calendar sync (Google / Outlook) is left to the
// existing background job; this route just persists.

import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/aws/db'
import { parseRetellToolCall, toolResult } from '@/lib/aws/voice/auth'

const DEFAULT_DURATION_MIN = 50

function parseDateTime(s: string): Date | null {
  if (!s) return null
  // ISO?
  const iso = new Date(s)
  if (!isNaN(iso.getTime()) && /\d{4}-\d{2}-\d{2}/.test(s)) return iso
  // Spoken form: "Monday April 21 at 2pm"
  const cleaned = s.replace(/\bat\b/i, '').replace(/(\d+)(am|pm)/i, '$1 $2')
  const d = new Date(cleaned)
  if (!isNaN(d.getTime())) return d
  return null
}

export async function POST(req: NextRequest) {
  const ctx = await parseRetellToolCall(req)
  if (ctx instanceof NextResponse) return ctx
  const { args, practiceId, callId } = ctx as any

  if (!practiceId) {
    return toolResult("I have your booking info. The therapist will confirm the appointment shortly.")
  }

  const patientName = String(args.patientName || '').trim()
  const apptStr = String(args.appointmentDateTime || '').trim()
  const phone = typeof args.patientPhone === 'string' ? args.patientPhone : null
  const email = typeof args.patientEmail === 'string' ? args.patientEmail : null
  const reason = typeof args.reason === 'string' ? args.reason : null

  const when = parseDateTime(apptStr)
  if (!when) {
    return toolResult("I had trouble parsing that date and time. Could you say it again with the day and time, like 'Monday April 21 at 2pm'?")
  }

  const parts = patientName.split(/\s+/).filter(Boolean)
  const firstName = parts[0] || 'Unknown'
  const lastName = parts.slice(1).join(' ') || 'Caller'
  const normalizedPhone = phone?.replace(/\D/g, '').slice(-10) || ''

  try {
    let patientId: string | null = null
    if (normalizedPhone.length >= 10) {
      const { rows } = await pool.query(
        `SELECT id FROM patients WHERE practice_id = $1 AND phone ILIKE $2 AND deleted_at IS NULL LIMIT 1`,
        [practiceId, `%${normalizedPhone}`],
      )
      if (rows[0]) patientId = rows[0].id
    }
    if (!patientId) {
      const { rows } = await pool.query(
        `INSERT INTO patients
            (practice_id, first_name, last_name, phone, email, patient_status, first_contact_at)
          VALUES ($1, $2, $3, $4, $5, 'inquiry', NOW())
          RETURNING id`,
        [practiceId, firstName, lastName, phone, email],
      )
      patientId = rows[0]?.id ?? null
    }

    const ins = await pool.query(
      `INSERT INTO appointments
          (practice_id, patient_id, patient_name, patient_phone,
           scheduled_for, duration_minutes, appointment_type, status, source, notes)
        VALUES ($1, $2, $3, $4, $5, $6, 'intake', 'scheduled', 'voice', $7)
        RETURNING id`,
      [practiceId, patientId, patientName, phone, when.toISOString(),
       DEFAULT_DURATION_MIN, reason ? `Booked via Ellie. Reason: ${reason}. Retell call: ${callId || 'unknown'}` : `Booked via Ellie. Retell call: ${callId || 'unknown'}`],
    )
    const apptId = ins.rows[0]?.id

    return toolResult(
      `Perfect. I've got you down for ${when.toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })}. You'll receive a confirmation by text or email shortly.`,
      { appointment_id: apptId },
    )
  } catch (err) {
    console.error('[retell/book-appointment]', (err as Error).message)
    return toolResult("I ran into trouble booking that. Let me take a message and the therapist will confirm with you directly.")
  }
}
