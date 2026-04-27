// app/api/ehr/appointments/[id]/telehealth/recording/[recordingId]/route.ts
//
// Wave 42 / T5 — POST = stop recording (atomic), DELETE = purge
// artifacts (operator-initiated, before retention_until).
//
// Stops are atomic: we update DB to 'stopping' BEFORE asking Chime
// to delete the pipeline. If the Chime delete fails, the row stays
// in 'stopping' state and the operator can retry (or a cron
// reconciler can sweep). The brief's 'recording either completes
// or is discarded' contract holds because every state transition
// is auditable + the partial unique index protects against
// double-recording.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
import { stopChimeRecording } from '@/lib/aws/chime-recording'
import { S3Client, DeleteObjectsCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

let _s3: S3Client | null = null
function s3() {
  if (!_s3) _s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' })
  return _s3
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; recordingId: string }> },
) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id: appointmentId, recordingId } = await params

  // Mark stopping atomically; only succeeds if currently recording.
  const upd = await pool.query(
    `UPDATE ehr_telehealth_recordings
        SET status = 'stopping'
      WHERE practice_id  = $1
        AND appointment_id = $2
        AND id           = $3
        AND status       = 'recording'
      RETURNING *`,
    [ctx.practiceId, appointmentId, recordingId],
  )
  if (upd.rows.length === 0) {
    return NextResponse.json(
      { error: { code: 'not_recording', message: 'Recording is not in the recording state.' } },
      { status: 409 },
    )
  }

  const row = upd.rows[0]
  const result = row.chime_pipeline_id
    ? await stopChimeRecording({ pipelineId: row.chime_pipeline_id })
    : { ok: true }

  if (!result.ok) {
    // Leave in 'stopping' so a retry can complete it.
    return NextResponse.json(
      {
        error: {
          code: 'chime_stop_failed',
          message: result.error ?? 'Chime did not accept the stop.',
        },
        recording: row,
      },
      { status: 502 },
    )
  }

  const startedMs = new Date(row.started_at).getTime()
  const durationSec = Math.max(0, Math.round((Date.now() - startedMs) / 1000))

  const final = await pool.query(
    `UPDATE ehr_telehealth_recordings
        SET status = 'available',
            stopped_at = NOW(),
            stopped_by_user_id = $1,
            duration_seconds = $2
      WHERE id = $3
      RETURNING *`,
    [ctx.user.id, durationSec, recordingId],
  )

  await auditEhrAccess({
    ctx,
    action: 'telehealth.recording.stopped',
    resourceType: 'ehr_telehealth_recording',
    resourceId: recordingId,
    details: {
      appointment_id: appointmentId,
      duration_seconds: durationSec,
    },
  })

  return NextResponse.json({ recording: final.rows[0] })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; recordingId: string }> },
) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id: appointmentId, recordingId } = await params

  const cur = await pool.query(
    `SELECT * FROM ehr_telehealth_recordings
      WHERE practice_id = $1 AND appointment_id = $2 AND id = $3
      LIMIT 1`,
    [ctx.practiceId, appointmentId, recordingId],
  )
  if (cur.rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (cur.rows[0].status === 'recording' || cur.rows[0].status === 'starting') {
    return NextResponse.json(
      { error: { code: 'still_recording', message: 'Stop the recording first before deleting.' } },
      { status: 409 },
    )
  }
  if (cur.rows[0].status === 'deleted') {
    return NextResponse.json({ ok: true, already_deleted: true })
  }

  // Best-effort S3 purge.
  if (cur.rows[0].s3_bucket && cur.rows[0].s3_key_prefix) {
    try {
      const listed = await s3().send(new ListObjectsV2Command({
        Bucket: cur.rows[0].s3_bucket,
        Prefix: cur.rows[0].s3_key_prefix,
      }))
      const objs = listed.Contents ?? []
      if (objs.length > 0) {
        // Chunk deletes in batches of 1000 (S3 limit).
        for (let i = 0; i < objs.length; i += 1000) {
          await s3().send(new DeleteObjectsCommand({
            Bucket: cur.rows[0].s3_bucket,
            Delete: {
              Objects: objs.slice(i, i + 1000)
                .filter((o) => o.Key)
                .map((o) => ({ Key: o.Key! })),
            },
          }))
        }
      }
    } catch (err) {
      console.error('[recording.delete] s3 purge failed:', (err as Error).message)
      // Don't block the DB-side delete on S3 failure; lifecycle
      // rule will still expire the objects at retention_until.
    }
  }

  await pool.query(
    `UPDATE ehr_telehealth_recordings SET status = 'deleted' WHERE id = $1`,
    [recordingId],
  )

  await auditEhrAccess({
    ctx,
    action: 'telehealth.recording.deleted',
    resourceType: 'ehr_telehealth_recording',
    resourceId: recordingId,
    details: { appointment_id: appointmentId, operator_initiated: true },
  })

  return NextResponse.json({ ok: true })
}
