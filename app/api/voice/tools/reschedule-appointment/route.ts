// app/api/voice/tools/reschedule-appointment/route.ts
//
// Wave 27c — Retell tool: reschedule an existing appointment to a new
// time (verified callers only). Done as a single transaction: cancel
// old + insert new, or UPDATE in place.

import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/aws/db'
import { parseRetellToolCall, toolResult } from '@/lib/aws/voice/auth'

function parseWhen(s: string): Date | null {
  if (!s) return null
  const d = new Date(s)
  if (!isNaN(d.getTime())) return d
  return null
}

export async function POST(req: NextRequest) {
  const ctx = await parseRetellToolCall(req)
  if (ctx instanceof NextResponse) return ctx
  const { args, practiceId } = ctx as any

  if (!practiceId) {
    return toolResult("I'm not able to look up that appointment right now. Let me take a message.")
  }

  const patientId = String(args.patientId || '').trim()
  const oldWhen = parseWhen(String(args.oldAppointmentDateTime || ''))
  const newWhen = parseWhen(String(args.newAppointmentDateTime || ''))

  if (!patientId || !oldWhen || !newWhen) {
    return toolResult("RESCHEDULE_INCOMPLETE: I need the patient ID, current appointment date/time, and the new time.")
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      `UPDATE appointments
          SET scheduled_for = $1,
              status = 'scheduled',
              updated_at = NOW(),
              notes = COALESCE(notes, '') || ' | rescheduled via Ellie'
        WHERE practice_id = $2
          AND patient_id = $3
          AND scheduled_for >= $4
          AND scheduled_for <= $5
          AND status IN ('scheduled','confirmed')
        RETURNING id`,
      [
        newWhen.toISOString(), practiceId, patientId,
        new Date(oldWhen.getTime() - 60_000).toISOString(),
        new Date(oldWhen.getTime() + 60_000).toISOString(),
      ],
    )
    if (rows.length === 0) {
      await client.query('ROLLBACK')
      return toolResult("RESCHEDULE_FAILED: I wasn't able to find the original appointment to move. Could the date or time be different?")
    }
    await client.query('COMMIT')
    return toolResult(`RESCHEDULE_OK: You're now scheduled for ${newWhen.toLocaleString()}. You'll get a text confirmation shortly.`)
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('[retell/reschedule-appointment]', (err as Error).message)
    return toolResult('I had trouble rescheduling that. Let me take a message so the therapist can confirm with you.')
  } finally {
    client.release()
  }
}
