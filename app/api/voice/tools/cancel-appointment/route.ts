// app/api/voice/tools/cancel-appointment/route.ts
//
// Wave 27c — Retell tool: cancel an existing appointment for a verified
// caller. patientId comes from the prior verifyIdentity call (the agent
// stores it in working memory and passes it back here).
//
// Wave 42 — Cancellation policy enforcement. After the appointment is
// flipped to status='cancelled' we evaluate the practice's policy via
// lib/aws/ehr/cancellation-policy.enforceLateCancelFee(). The library
// is a no-op when no policy is configured. Charge failures never block
// the cancellation — they fall back to the billable-on-invoice path.

import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/aws/db'
import { parseRetellToolCall, toolResult } from '@/lib/aws/voice/auth'
import { enforceLateCancelFee } from '@/lib/aws/ehr/cancellation-policy'

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
    return toolResult("I'm not able to look up that appointment right now. Let me take a message and the therapist will follow up.")
  }

  const patientId = String(args.patientId || '').trim()
  const whenStr = String(args.appointmentDateTime || '').trim()
  const when = parseWhen(whenStr)

  if (!patientId) {
    return toolResult("I need to verify your identity before cancelling — could you give me your first name, last name, and date of birth?")
  }
  if (!when) {
    return toolResult("Which appointment would you like to cancel? I have the date/time on file but want to confirm the right one.")
  }

  try {
    const { rows } = await pool.query(
      `UPDATE appointments
          SET status = 'cancelled',
              cancelled_at = NOW(),
              cancellation_source = 'voice'
        WHERE practice_id = $1
          AND patient_id = $2
          AND scheduled_for >= $3
          AND scheduled_for <= $4
          AND status IN ('scheduled','confirmed')
        RETURNING id, scheduled_for`,
      [
        practiceId, patientId,
        new Date(when.getTime() - 60_000).toISOString(),
        new Date(when.getTime() + 60_000).toISOString(),
      ],
    )
    if (rows.length === 0) {
      return toolResult("CANCEL_FAILED: I wasn't able to find that appointment on the calendar. Could the date or time be different?")
    }

    // Apply per-practice cancellation policy. Voice-initiated cancels
    // count as patient-initiated (the caller has been identity-verified
    // upstream via verifyIdentity).
    let policySuffix = ''
    try {
      const fee = await enforceLateCancelFee(rows[0].id, 'voice')
      if (fee.status === 'charged' && fee.amountCents) {
        policySuffix = ` Because you're cancelling within the practice's policy window, a $${(fee.amountCents / 100).toFixed(2)} late-cancellation fee was charged to the card on file.`
      } else if ((fee.status === 'billable' || fee.status === 'failed') && fee.amountCents) {
        policySuffix = ` Because you're cancelling within the practice's policy window, a $${(fee.amountCents / 100).toFixed(2)} late-cancellation fee will be added to your next invoice.`
      }
    } catch (err) {
      console.error('[retell/cancel-appointment] policy enforcement failed:', (err as Error).message)
    }

    return toolResult(`CANCEL_OK: I've cancelled your appointment on ${when.toLocaleString()}.${policySuffix} You'll receive a text confirmation shortly.`)
  } catch (err) {
    console.error('[retell/cancel-appointment]', (err as Error).message)
    return toolResult('I had trouble cancelling that. Let me take a message so the therapist can follow up directly.')
  }
}
