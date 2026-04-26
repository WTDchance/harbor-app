// Therapist-side scheduling requests — list of patient-submitted timeslot
// requests pending therapist response.
//
// GET → list, optional ?status= filter.
// POST/PATCH approve/decline are write paths and stay in legacy until the
// notification fan-out wave (creating an appointment + notifying patient).

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  if (!ctx.practiceId) return NextResponse.json({ requests: [] })

  const status = req.nextUrl.searchParams.get('status')
  const conds: string[] = ['practice_id = $1']
  const args: unknown[] = [ctx.practiceId]
  if (status) { args.push(status); conds.push(`status = $${args.length}`) }

  const { rows } = await pool.query(
    `SELECT id, patient_id, preferred_windows, patient_note, therapist_note,
            duration_minutes, appointment_type, status, appointment_id,
            created_at, responded_at
       FROM ehr_scheduling_requests
      WHERE ${conds.join(' AND ')}
      ORDER BY created_at DESC LIMIT 200`,
    args,
  )

  return NextResponse.json({ requests: rows })
}
