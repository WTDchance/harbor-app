// app/api/ehr/appointments/[id]/telehealth/recording/route.ts
//
// Wave 42 / T5 — start a telehealth recording. Therapist-controlled.
// Refuses without an active 'telehealth_recording' consent on the
// patient's signed consents.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess, auditSystemEvent } from '@/lib/aws/ehr/audit'
import { startChimeRecording } from '@/lib/aws/chime-recording'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const RECORDINGS_BUCKET =
  process.env.CHIME_RECORDINGS_BUCKET ||
  // Fallback for staging matches the terraform-generated name
  // <name_prefix>-chime-recordings; the env var should be set on
  // ECS post-apply.
  'harbor-staging-chime-recordings'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id: appointmentId } = await params

  const { rows } = await pool.query(
    `SELECT * FROM ehr_telehealth_recordings
      WHERE practice_id = $1 AND appointment_id = $2
      ORDER BY started_at DESC`,
    [ctx.practiceId, appointmentId],
  )
  return NextResponse.json({ recordings: rows })
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id: appointmentId } = await params

  // Load appointment + meeting + patient.
  const apptRes = await pool.query(
    `SELECT id, patient_id, video_meeting_id, video_provider
       FROM appointments
      WHERE practice_id = $1 AND id = $2 LIMIT 1`,
    [ctx.practiceId, appointmentId],
  )
  const appt = apptRes.rows[0]
  if (!appt) return NextResponse.json({ error: 'Appointment not found' }, { status: 404 })
  if (appt.video_provider !== 'chime' || !appt.video_meeting_id) {
    return NextResponse.json(
      { error: { code: 'no_chime_meeting', message: 'No Chime meeting on this appointment.' } },
      { status: 409 },
    )
  }

  // Consent gate — must have an active, non-revoked
  // consent_signatures row with kind='telehealth_recording' for
  // this patient.
  const consent = await pool.query(
    `SELECT cs.id
       FROM consent_signatures cs
       JOIN consent_documents cd ON cd.id = cs.document_id
      WHERE cs.patient_id = $1
        AND cd.kind = 'telehealth_recording'
        AND cs.revoked_at IS NULL
      ORDER BY cs.signed_at DESC
      LIMIT 1`,
    [appt.patient_id],
  ).catch(() => ({ rows: [] as any[] }))
  if (consent.rows.length === 0) {
    await auditEhrAccess({
      ctx,
      action: 'telehealth.recording.consent_missing',
      resourceType: 'appointment',
      resourceId: appointmentId,
      details: { patient_id: appt.patient_id },
    })
    return NextResponse.json(
      {
        error: {
          code: 'consent_missing',
          message:
            'Patient has not signed the telehealth_recording consent. Capture consent before starting a recording.',
        },
      },
      { status: 409 },
    )
  }

  // Insert pending row (status='starting'). Unique partial index
  // protects against a double-start.
  let recordingRow: any
  try {
    const ins = await pool.query(
      `INSERT INTO ehr_telehealth_recordings
         (appointment_id, practice_id, patient_id,
          chime_meeting_id, consent_signature_id,
          started_by_user_id, status,
          retention_until)
       VALUES ($1, $2, $3, $4, $5, $6, 'starting',
               (NOW() + INTERVAL '7 years')::date)
       RETURNING *`,
      [
        appointmentId, ctx.practiceId, appt.patient_id,
        appt.video_meeting_id, consent.rows[0].id, ctx.user.id,
      ],
    )
    recordingRow = ins.rows[0]
  } catch (err: any) {
    if (err?.code === '23505') {
      return NextResponse.json(
        { error: { code: 'already_recording', message: 'Recording already in progress for this meeting.' } },
        { status: 409 },
      )
    }
    throw err
  }

  // Build Chime meeting ARN. The MediaCapturePipeline takes an ARN
  // form; we construct it from the AWS account id (env) + region +
  // meeting id.
  const acctId = process.env.AWS_ACCOUNT_ID || '417242953135'
  const region = process.env.CHIME_REGION || process.env.AWS_REGION || 'us-east-1'
  const meetingArn = `arn:aws:chime::${acctId}:meeting:${appt.video_meeting_id}`
  const keyPrefix = `${ctx.practiceId}/${appointmentId}/${recordingRow.id}/`

  const result = await startChimeRecording({
    meetingArn,
    s3Bucket: RECORDINGS_BUCKET,
    s3KeyPrefix: keyPrefix,
  })

  if (!result.ok) {
    // Mark as error; the unique partial index frees up so a retry
    // is possible after the operator fixes the cause.
    await pool.query(
      `UPDATE ehr_telehealth_recordings
          SET status = 'error', error_reason = $1
        WHERE id = $2`,
      [result.error ?? 'unknown', recordingRow.id],
    ).catch(() => {})
    return NextResponse.json(
      {
        error: {
          code: 'chime_start_failed',
          message: result.error ?? 'Chime did not accept the recording start.',
        },
      },
      { status: 502 },
    )
  }

  const updated = await pool.query(
    `UPDATE ehr_telehealth_recordings
        SET status = 'recording',
            chime_pipeline_id = $1,
            s3_bucket = $2,
            s3_key_prefix = $3
      WHERE id = $4
      RETURNING *`,
    [result.pipelineId, result.s3Bucket, result.s3KeyPrefix, recordingRow.id],
  )

  await auditEhrAccess({
    ctx,
    action: 'telehealth.recording.started',
    resourceType: 'ehr_telehealth_recording',
    resourceId: recordingRow.id,
    details: {
      appointment_id: appointmentId,
      patient_id: appt.patient_id,
      consent_signature_id: consent.rows[0].id,
      chime_pipeline_id: result.pipelineId,
    },
  })

  return NextResponse.json({ recording: updated.rows[0] }, { status: 201 })
}
