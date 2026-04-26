// app/api/voice/tools/set-communication-preference/route.ts
//
// Wave 27c — Retell tool: flip SMS / email / call opt-out for a
// verified patient. Writes to the per-channel opt-out tables directly
// (skipping the Bucket-5 helper libs).

import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/aws/db'
import { parseRetellToolCall, toolResult } from '@/lib/aws/voice/auth'

export async function POST(req: NextRequest) {
  const ctx = await parseRetellToolCall(req)
  if (ctx instanceof NextResponse) return ctx
  const { args, practiceId } = ctx as any

  if (!practiceId) {
    return toolResult("I'll make a note for the therapist to update your preferences.")
  }
  const patientId = String(args.patientId || '').trim()
  if (!patientId) {
    return toolResult('I need to verify you first before changing those preferences.')
  }

  // Resolve patient phone + email
  const { rows: pRows } = await pool.query(
    `SELECT phone, email FROM patients
      WHERE id = $1 AND practice_id = $2 AND deleted_at IS NULL LIMIT 1`,
    [patientId, practiceId],
  )
  if (pRows.length === 0) return toolResult("PREFERENCE_FAILED: I couldn't find that record.")
  const { phone, email } = pRows[0]

  const changes: string[] = []
  try {
    if (typeof args.optOutSms === 'boolean' && phone) {
      if (args.optOutSms) {
        await pool.query(
          `INSERT INTO sms_opt_outs (practice_id, phone, keyword, source)
            VALUES ($1, $2, 'VOICE', 'voice')
            ON CONFLICT (practice_id, phone) DO UPDATE SET source = 'voice'`,
          [practiceId, phone],
        )
        changes.push('SMS opted out')
      } else {
        await pool.query(`DELETE FROM sms_opt_outs WHERE practice_id = $1 AND phone = $2`, [practiceId, phone])
        changes.push('SMS re-enabled')
      }
    }
    if (typeof args.optOutEmail === 'boolean' && email) {
      if (args.optOutEmail) {
        await pool.query(
          `INSERT INTO email_opt_outs (practice_id, email, source) VALUES ($1, $2, 'voice')
            ON CONFLICT (practice_id, email) DO UPDATE SET source = 'voice'`,
          [practiceId, email],
        )
        changes.push('email opted out')
      } else {
        await pool.query(`DELETE FROM email_opt_outs WHERE practice_id = $1 AND email = $2`, [practiceId, email])
        changes.push('email re-enabled')
      }
    }
    if (typeof args.optOutCall === 'boolean' && phone) {
      if (args.optOutCall) {
        await pool.query(
          `INSERT INTO call_opt_outs (practice_id, phone, source) VALUES ($1, $2, 'voice')
            ON CONFLICT (practice_id, phone) DO UPDATE SET source = 'voice'`,
          [practiceId, phone],
        )
        changes.push('calls opted out')
      } else {
        await pool.query(`DELETE FROM call_opt_outs WHERE practice_id = $1 AND phone = $2`, [practiceId, phone])
        changes.push('calls re-enabled')
      }
    }
  } catch (err) {
    console.error('[retell/set-communication-preference]', (err as Error).message)
    return toolResult('I had trouble updating that preference. Let me take a message for the therapist.')
  }

  if (changes.length === 0) {
    return toolResult('I don\'t see a change to make there. Could you tell me which channel you wanted to change?')
  }
  return toolResult(`PREFERENCE_OK: Got it — ${changes.join(', ')}.`)
}
