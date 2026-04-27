// Therapist-side thread read. Loads thread + messages and marks any
// patient-sent messages as read.
//
// PATCH and DELETE are not implemented in legacy; AWS port returns 501
// stubs so the routes respond cleanly to those verbs.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
import { pool } from '@/lib/aws/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id } = await params

  const threadRes = await pool.query(
    `SELECT * FROM ehr_message_threads
      WHERE id = $1 AND practice_id = $2
      LIMIT 1`,
    [id, ctx.practiceId],
  ).catch(() => ({ rows: [] as any[] }))
  const thread = threadRes.rows[0]
  if (!thread) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const msgRes = await pool.query(
    `SELECT id, sender_type, body, created_at, read_at
       FROM ehr_messages
      WHERE thread_id = $1
      ORDER BY created_at ASC`,
    [id],
  )

  // Mark patient messages as read by practice (best-effort, fire-and-forget).
  if (thread.unread_by_practice_count > 0) {
    pool.query(
      `UPDATE ehr_message_threads
          SET unread_by_practice_count = 0
        WHERE id = $1`,
      [id],
    ).catch(() => {})
    pool.query(
      `UPDATE ehr_messages
          SET read_at = NOW()
        WHERE thread_id = $1 AND sender_type = 'patient' AND read_at IS NULL`,
      [id],
    ).catch(() => {})
  }

  await auditEhrAccess({
    ctx,
    action: 'message.thread.view',
    resourceType: 'ehr_message_thread',
    resourceId: id,
    details: {
      message_count: msgRes.rows.length,
      messages_marked_read: thread.unread_by_practice_count ?? 0,
    },
  })
  return NextResponse.json({ thread, messages: msgRes.rows })
}

// TODO(phase-4b): port PATCH (thread state changes — archive, etc.) and
// DELETE (thread / message removal) once those flows have a designed UX.
// Legacy never implemented these verbs.
export async function PATCH() {
  return NextResponse.json(
    { error: 'message_thread_patch_not_implemented_on_aws_yet' },
    { status: 501 },
  )
}
export async function DELETE() {
  return NextResponse.json(
    { error: 'message_thread_delete_not_implemented_on_aws_yet' },
    { status: 501 },
  )
}
