// Patient portal — read a single thread (with all its messages) AND mark
// any practice-side messages as read. Mirrors legacy GET semantics.

import { NextResponse, type NextRequest } from 'next/server'
import { requirePortalSession } from '@/lib/aws/portal-auth'
import { pool } from '@/lib/aws/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const sess = await requirePortalSession()
  if (sess instanceof NextResponse) return sess
  const { id } = await params

  const threadRes = await pool.query(
    `SELECT * FROM ehr_message_threads WHERE id = $1 LIMIT 1`,
    [id],
  ).catch(() => ({ rows: [] as any[] }))
  const thread = threadRes.rows[0]
  if (!thread || thread.patient_id !== sess.patientId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const msgRes = await pool.query(
    `SELECT id, sender_type, body, created_at, read_at
       FROM ehr_messages
      WHERE thread_id = $1
      ORDER BY created_at ASC`,
    [id],
  )

  // Mark practice-side messages as read by the patient.
  if (thread.unread_by_patient_count > 0) {
    pool.query(
      `UPDATE ehr_message_threads
          SET unread_by_patient_count = 0
        WHERE id = $1`,
      [id],
    ).catch(() => {})
    pool.query(
      `UPDATE ehr_messages
          SET read_at = NOW()
        WHERE thread_id = $1 AND sender_type = 'practice' AND read_at IS NULL`,
      [id],
    ).catch(() => {})
  }

  return NextResponse.json({ thread, messages: msgRes.rows })
}
