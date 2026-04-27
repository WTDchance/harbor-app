// app/api/ehr/appointments/[id]/telehealth/recording/[recordingId]/playback/route.ts
//
// Wave 43 / T0 — generate a presigned S3 URL for therapist-side
// recording playback. 1-hour TTL.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
import { presignedGetUrl } from '@/lib/aws/s3'
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

let _s3: S3Client | null = null
function s3() {
  if (!_s3) _s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' })
  return _s3
}

const TTL = 3600

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; recordingId: string }> },
) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id: appointmentId, recordingId } = await params

  const cur = await pool.query(
    `SELECT * FROM ehr_telehealth_recordings
      WHERE practice_id = $1 AND appointment_id = $2 AND id = $3 LIMIT 1`,
    [ctx.practiceId, appointmentId, recordingId],
  )
  if (cur.rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const r = cur.rows[0]
  if (r.status !== 'available') {
    return NextResponse.json(
      { error: { code: 'not_available', message: `Recording is ${r.status}, not available for playback yet.` } },
      { status: 409 },
    )
  }
  if (!r.s3_bucket || !r.s3_key_prefix) {
    return NextResponse.json({ error: 'Recording has no S3 location on file' }, { status: 500 })
  }

  const listed = await s3().send(new ListObjectsV2Command({
    Bucket: r.s3_bucket,
    Prefix: r.s3_key_prefix,
    MaxKeys: 100,
  }))
  const keys = (listed.Contents ?? []).map((o) => o.Key).filter(Boolean) as string[]
  if (keys.length === 0) {
    return NextResponse.json(
      { error: { code: 'no_artifacts', message: 'No recording artifacts on file yet. Try again in a minute.' } },
      { status: 404 },
    )
  }

  const mp4 = keys.find((k) => k.toLowerCase().endsWith('.mp4'))
  const m3u8 = keys.find((k) => k.toLowerCase().endsWith('.m3u8'))
  const primary = mp4 ?? m3u8 ?? keys[0]

  const url = await presignedGetUrl(r.s3_bucket, primary, TTL)

  await auditEhrAccess({
    ctx,
    action: 'telehealth.recording.playback_url_generated',
    resourceType: 'ehr_telehealth_recording',
    resourceId: recordingId,
    details: {
      appointment_id: appointmentId,
      key: primary,
      ttl_seconds: TTL,
    },
  })

  return NextResponse.json({ url, expires_in_seconds: TTL, key: primary, artifacts: keys })
}
