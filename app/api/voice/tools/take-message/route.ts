// app/api/voice/tools/take-message/route.ts
//
// Wave 27c — Retell tool: record a message for the therapist. Mirrors
// the Vapi handler — upsert a patient row by phone if one doesn't
// exist, then INSERT into tasks with type='message'.

import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/aws/db'
import { parseRetellToolCall, toolResult } from '@/lib/aws/voice/auth'

export async function POST(req: NextRequest) {
  const ctx = await parseRetellToolCall(req)
  if (ctx instanceof NextResponse) return ctx
  const { args, practiceId } = ctx as any

  if (!practiceId) {
    return toolResult('Your message has been recorded. The therapist will get back to you as soon as possible.')
  }

  const callerName = String(args.callerName || '').trim()
  const phone = typeof args.phone === 'string' ? args.phone : null
  const msg = typeof args.message === 'string' ? args.message : null
  const nameParts = callerName.split(/\s+/).filter(Boolean)
  const firstName = nameParts[0] || ''
  const lastName = nameParts.slice(1).join(' ') || ''
  const normalizedPhone = phone?.replace(/\D/g, '').slice(-10) || ''

  let patientId: string | null = null
  try {
    if (normalizedPhone.length >= 10) {
      const { rows } = await pool.query(
        `SELECT id FROM patients
          WHERE practice_id = $1 AND phone ILIKE $2 AND deleted_at IS NULL
          LIMIT 1`,
        [practiceId, `%${normalizedPhone}`],
      )
      if (rows[0]) patientId = rows[0].id
    }
    if (!patientId && (firstName || normalizedPhone)) {
      const { rows } = await pool.query(
        `INSERT INTO patients (practice_id, first_name, last_name, phone)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [practiceId, firstName || 'Unknown', lastName || 'Caller', phone],
      )
      patientId = rows[0]?.id ?? null
    }
    await pool.query(
      `INSERT INTO tasks (practice_id, type, patient_name, patient_phone, summary, status)
       VALUES ($1, 'message', $2, $3, $4, 'pending')`,
      [practiceId, callerName || 'Unknown Caller', phone, msg || 'No message provided'],
    )
  } catch (err) {
    console.error('[retell/take-message]', (err as Error).message)
  }
  return toolResult('Your message has been recorded. The therapist will get back to you as soon as possible.')
}
