// Harbor EHR — list patient↔practice message threads.
//
// POST (send a message / open a new thread) is intentionally not ported
// in this batch — it's a 3-step multi-table write (thread upsert + message
// insert + thread.last_message_* update) that wants a transaction. Lives
// in phase-4b alongside the other write-path EHR routes. See TODO below.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const patientId = req.nextUrl.searchParams.get('patient_id')
  const conds: string[] = ['practice_id = $1']
  const args: unknown[] = [ctx.practiceId]
  if (patientId) { args.push(patientId); conds.push(`patient_id = $${args.length}`) }

  const { rows } = await pool.query(
    `SELECT id, patient_id, subject, last_message_at, last_message_preview,
            unread_by_practice_count, created_at
       FROM ehr_message_threads
      WHERE ${conds.join(' AND ')}
      ORDER BY last_message_at DESC NULLS LAST, created_at DESC
      LIMIT 100`,
    args,
  )

  await auditEhrAccess({
    ctx,
    action: 'message.list',
    resourceType: 'ehr_message_thread',
    details: { count: rows.length, patient_id: patientId },
  })
  return NextResponse.json({ threads: rows })
}

// TODO(phase-4b): port POST. Three writes in one logical op
// (ehr_message_threads insert/lookup, ehr_messages insert, threads update of
// last_message_*). Wrap in a pool transaction. Until then, sending a message
// is unavailable on AWS staging — list view stays functional.
export async function POST() {
  return NextResponse.json(
    { error: 'message_send_not_implemented_on_aws_yet' },
    { status: 501 },
  )
}
