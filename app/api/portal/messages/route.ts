// Patient portal — list threads + send a new message.
//
// GET → list of threads for the signed-in patient.
// POST → 3-write transaction:
//   1. INSERT ehr_message_threads if no thread_id supplied (new conversation),
//      OR verify ownership of the existing thread_id.
//   2. INSERT ehr_messages (sender_type='patient').
//   3. UPDATE ehr_message_threads SET last_message_at, last_message_preview,
//      unread_by_practice_count = COALESCE(unread_by_practice_count, 0) + 1.
// Wrapped in BEGIN/COMMIT; ROLLBACK on any failure so partial writes
// (orphan thread, ghost message, stale unread counter) cannot occur.

import { NextResponse, type NextRequest } from 'next/server'
import { requirePortalSession } from '@/lib/aws/portal-auth'
import { pool } from '@/lib/aws/db'
import { auditPortalAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const sess = await requirePortalSession()
  if (sess instanceof NextResponse) return sess

  const { rows } = await pool
    .query(
      `SELECT id, subject, last_message_at, last_message_preview,
              unread_by_patient_count, created_at
         FROM ehr_message_threads
        WHERE practice_id = $1 AND patient_id = $2
        ORDER BY last_message_at DESC NULLS LAST, created_at DESC`,
      [sess.practiceId, sess.patientId],
    )
    .catch(() => ({ rows: [] as any[] }))

  return NextResponse.json({ threads: rows })
}

export async function POST(req: NextRequest) {
  const sess = await requirePortalSession()
  if (sess instanceof NextResponse) return sess

  const body = await req.json().catch(() => null) as {
    body?: string; subject?: string; thread_id?: string
  } | null
  if (!body?.body) return NextResponse.json({ error: 'body required' }, { status: 400 })

  const messageBody = String(body.body)
  const preview = messageBody.slice(0, 140)

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // Step 1: thread upsert — either resolve an existing thread (with
    // ownership check) or create a new one. Lock the thread row for the
    // subsequent UPDATE so concurrent sends to the same thread serialize.
    let threadId = body.thread_id
    if (threadId) {
      const own = await client.query(
        `SELECT id, patient_id FROM ehr_message_threads
          WHERE id = $1 AND practice_id = $2
          FOR UPDATE`,
        [threadId, sess.practiceId],
      )
      const t = own.rows[0]
      if (!t || t.patient_id !== sess.patientId) {
        await client.query('ROLLBACK')
        client.release()
        return NextResponse.json({ error: 'Not found' }, { status: 404 })
      }
    } else {
      const subject = body.subject || `Question from ${sess.firstName || 'patient'}`
      const ins = await client.query(
        `INSERT INTO ehr_message_threads (practice_id, patient_id, subject)
         VALUES ($1, $2, $3) RETURNING id`,
        [sess.practiceId, sess.patientId, subject],
      )
      threadId = ins.rows[0].id
    }

    // Step 2: insert the message.
    const msgIns = await client.query(
      `INSERT INTO ehr_messages (
         thread_id, practice_id, patient_id,
         sender_type, body
       ) VALUES ($1, $2, $3, 'patient', $4)
       RETURNING id, created_at`,
      [threadId, sess.practiceId, sess.patientId, messageBody],
    )
    const msg = msgIns.rows[0]

    // Step 3: bump thread metadata. unread_by_practice_count uses
    // COALESCE+1 so the increment is idempotent across concurrent sends
    // (the FOR UPDATE above already serialized them).
    await client.query(
      `UPDATE ehr_message_threads
          SET last_message_at = $1,
              last_message_preview = $2,
              unread_by_practice_count = COALESCE(unread_by_practice_count, 0) + 1
        WHERE id = $3`,
      [msg.created_at, preview, threadId],
    )

    await client.query('COMMIT')
    client.release()

    auditPortalAccess({
      session: sess,
      action: 'portal.message.send',
      resourceType: 'ehr_message_thread',
      resourceId: threadId!,
      details: { length: messageBody.length, new_thread: !body.thread_id },
    }).catch(() => {})

    return NextResponse.json(
      { thread_id: threadId, message: { id: msg.id, created_at: msg.created_at } },
      { status: 201 },
    )
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    client.release()
    return NextResponse.json(
      { error: (err as Error).message || 'Internal server error' },
      { status: 500 },
    )
  }
}
