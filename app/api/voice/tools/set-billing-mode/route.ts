// app/api/voice/tools/set-billing-mode/route.ts
//
// Wave 27c — Retell tool: switch a verified patient's billing mode
// between insurance, self_pay, sliding_scale. Same insurance-records
// archive/reactivate semantics as /api/patients/[id]/billing-mode.

import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/aws/db'
import { parseRetellToolCall, toolResult } from '@/lib/aws/voice/auth'

const ALLOWED = new Set(['insurance', 'self_pay', 'sliding_scale'])

export async function POST(req: NextRequest) {
  const ctx = await parseRetellToolCall(req)
  if (ctx instanceof NextResponse) return ctx
  const { args, practiceId } = ctx as any

  if (!practiceId) {
    return toolResult("I'll make a note for the therapist to update your billing.")
  }
  const patientId = String(args.patientId || '').trim()
  const mode = String(args.mode || '').trim()

  if (!patientId || !ALLOWED.has(mode)) {
    return toolResult("BILLING_FAILED: I need a valid mode (insurance, self_pay, or sliding_scale) and a verified patient.")
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `UPDATE patients SET billing_mode = $1 WHERE id = $2 AND practice_id = $3`,
      [mode, patientId, practiceId],
    )
    if (mode === 'self_pay') {
      await client.query(
        `UPDATE insurance_records SET status = 'archived', archived_at = NOW()
          WHERE patient_id = $1 AND practice_id = $2 AND status = 'active'`,
        [patientId, practiceId],
      )
    } else if (mode === 'insurance') {
      const { rows } = await client.query(
        `SELECT id FROM insurance_records
          WHERE patient_id = $1 AND practice_id = $2 AND status = 'archived'
          ORDER BY archived_at DESC NULLS LAST LIMIT 1`,
        [patientId, practiceId],
      )
      if (rows[0]?.id) {
        await client.query(
          `UPDATE insurance_records SET status = 'active', archived_at = NULL WHERE id = $1`,
          [rows[0].id],
        )
      }
    }
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('[retell/set-billing-mode]', (err as Error).message)
    return toolResult('I had trouble updating that. Let me take a message for the therapist.')
  } finally {
    client.release()
  }

  return toolResult(`BILLING_OK: I've switched your billing to ${mode.replace('_', ' ')}.`)
}
