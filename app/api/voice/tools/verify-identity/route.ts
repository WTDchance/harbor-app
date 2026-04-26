// app/api/voice/tools/verify-identity/route.ts
//
// Wave 27c — Retell tool: verify caller identity by matching first
// name + last name + DOB against the practice's patients table.
// Returns one of:
//   VERIFICATION_OK:<patientId>
//   VERIFICATION_FAILED
//   VERIFICATION_INCOMPLETE
//
// The agent prompt gates all PHI disclosure on a successful
// verifyIdentity result, so this string contract MUST stay byte-stable.

import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/aws/db'
import { parseRetellToolCall, toolResult, normalizeName, normalizeDOB } from '@/lib/aws/voice/auth'

export async function POST(req: NextRequest) {
  const ctx = await parseRetellToolCall(req)
  if (ctx instanceof NextResponse) return ctx

  const { args, practiceId } = ctx as any
  if (!practiceId) {
    return toolResult('I was not able to verify that right now. Let me take a message for the team instead.')
  }

  const firstName = normalizeName(args.firstName)
  const lastName = normalizeName(args.lastName)
  const dobIso = normalizeDOB(args.dateOfBirth)

  if (!firstName || !lastName || !dobIso) {
    return toolResult('VERIFICATION_INCOMPLETE: I still need the full first name, last name, and date of birth to verify.')
  }

  try {
    const { rows } = await pool.query(
      `SELECT id, first_name, last_name, date_of_birth FROM patients
        WHERE practice_id = $1 AND deleted_at IS NULL
        LIMIT 2000`,
      [practiceId],
    )
    const match = rows.find((p: any) => {
      if (!p.first_name || !p.last_name || !p.date_of_birth) return false
      if (normalizeName(p.first_name) !== firstName) return false
      if (normalizeName(p.last_name) !== lastName) return false
      return normalizeDOB(String(p.date_of_birth)) === dobIso
    })
    if (!match) {
      return toolResult("VERIFICATION_FAILED: I wasn't able to find a record that matches. For your privacy, I can't share details without a match. I can take a message for the therapist instead.")
    }
    return toolResult(`VERIFICATION_OK:${match.id}`)
  } catch (err) {
    console.error('[retell/verify-identity]', (err as Error).message)
    return toolResult('I was not able to verify that right now. Let me take a message so the team can follow up.')
  }
}
