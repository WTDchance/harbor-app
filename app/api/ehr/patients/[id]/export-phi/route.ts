// app/api/ehr/patients/[id]/export-phi/route.ts
//
// Single-patient PHI export — Wave 39 follow-up to the practice
// decommission feature. Therapist-initiated. Builds a complete ZIP of
// every record we have for one patient, uploads it to the dedicated
// PHI-exports S3 bucket (KMS-encrypted, 7-day lifecycle), and returns a
// 24-hour presigned download URL.
//
// Auth: requireEhrApiSession() — same gate as every other /api/ehr/*
// route. The session's practice_id has to match the patient's
// practice_id, otherwise 404 (we never confirm cross-practice patient
// existence).
//
// Tables read are joined in lib/aws/ehr/phi-export.ts. Wave 39 tables
// (mental_status_exams, discharge_summaries, treatment_plan_reviews,
// mandatory_reports) are gracefully skipped if not yet present.
//
// Audit: writes one audit_logs row with action='patient.phi.exported',
// actor user id, target patient id, and metadata = { export_id,
// exported_at, item_counts }.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
import {
  collectPatientPhi,
  buildPatientZip,
  uploadExportToS3,
  presignExportUrl,
  newExportId,
  countItems,
} from '@/lib/aws/ehr/phi-export'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// PHI export can be slow if the patient has lots of notes/audit rows.
export const maxDuration = 60

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  if (!ctx.practiceId) {
    return NextResponse.json({ error: 'practice_required' }, { status: 403 })
  }

  const { id: patientId } = await params
  if (!patientId) {
    return NextResponse.json({ error: 'patient_id_required' }, { status: 400 })
  }

  // collectPatientPhi already enforces (id, practice_id) — if it returns
  // null, the patient either doesn't exist or belongs to another practice.
  const phi = await collectPatientPhi({ patientId, practiceId: ctx.practiceId })
  if (!phi) {
    return NextResponse.json({ error: 'patient_not_found' }, { status: 404 })
  }

  const exportId = newExportId()
  const exportedAt = new Date().toISOString()
  const exportedByEmail = ctx.session.email

  let zip: Buffer
  try {
    zip = (await buildPatientZip({
      exportId,
      exportedByEmail,
      patientId,
      practiceId: ctx.practiceId,
      phi,
    }))!
  } catch (err) {
    console.error('[phi-export] buildPatientZip failed:', (err as Error).message)
    return NextResponse.json({ error: 'export_build_failed' }, { status: 500 })
  }

  const key = `patient/${ctx.practiceId}/${patientId}/${exportId}.zip`
  try {
    await uploadExportToS3({ key, body: zip })
  } catch (err) {
    console.error('[phi-export] s3 upload failed:', (err as Error).message)
    return NextResponse.json({ error: 'export_upload_failed' }, { status: 502 })
  }

  const url = await presignExportUrl({ key, ttlSeconds: 24 * 3600 })
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString()
  const itemCounts = countItems(phi)

  await auditEhrAccess({
    ctx,
    action: 'patient.phi.exported',
    resourceType: 'patient',
    resourceId: patientId,
    details: {
      export_id: exportId,
      exported_at: exportedAt,
      s3_key: key,
      item_counts: itemCounts,
    },
  })

  return NextResponse.json({
    url,
    expires_at: expiresAt,
    export_id: exportId,
    item_counts: itemCounts,
  })
}
