// app/api/portal/insurance-card/route.ts
//
// W44 T6 — patient-portal insurance card scan.
//
// Mirrors the W41 therapist endpoint at
// /api/ehr/patients/[id]/insurance-card but scoped to the signed-in
// portal patient (no patient_id query param — derived from session).
// Stamps scanned_by_role='patient' so the therapist can distinguish
// patient-self-uploaded scans on review.
//
// The patient does NOT immediately update their patients.insurance_*
// columns from this endpoint — the parsed fields are stored in
// ehr_insurance_card_scans only. The therapist confirms and writes
// to the patient row from their dashboard.

import { NextResponse, type NextRequest } from 'next/server'
import { randomUUID } from 'crypto'
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'

import { requirePortalSession } from '@/lib/aws/portal-auth'
import { auditPortalAccess } from '@/lib/aws/ehr/audit'
import { pool } from '@/lib/aws/db'
import {
  analyzeFormsFromBytes,
  type AnalyzeFormsResult,
} from '@/lib/aws/textract'
import {
  extractInsuranceFields,
  mergeFields,
  aggregateConfidence,
  lowConfidenceFields,
  INSURANCE_FIELD_KEYS,
  type InsuranceCardFields,
} from '@/lib/aws/ehr/insurance-card/parse'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/heic', 'image/webp']
const MAX_BYTES = 10 * 1024 * 1024 // 10 MB per side
const REVIEW_THRESHOLD = 0.85

let _s3: S3Client | null = null
function s3(): S3Client {
  if (!_s3) _s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' })
  return _s3
}

function insuranceCardsBucket(): string {
  return (
    process.env.S3_INSURANCE_CARDS_BUCKET ||
    process.env.INSURANCE_CARDS_BUCKET ||
    ''
  )
}

export async function POST(req: NextRequest) {
  const sess = await requirePortalSession()
  if (sess instanceof NextResponse) return sess

  const bucket = insuranceCardsBucket()
  if (!bucket) {
    return NextResponse.json(
      { error: 'insurance_cards_bucket_not_configured' },
      { status: 500 },
    )
  }

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json(
      { error: 'expected_multipart_form_data' },
      { status: 400 },
    )
  }

  const front = formData.get('card_front')
  const back = formData.get('card_back')
  const frontFile = front instanceof File ? front : null
  const backFile = back instanceof File ? back : null
  if (!frontFile && !backFile) {
    return NextResponse.json(
      { error: 'at_least_one_image_required' },
      { status: 400 },
    )
  }

  for (const f of [frontFile, backFile]) {
    if (!f) continue
    if (!ALLOWED_TYPES.includes(f.type)) {
      return NextResponse.json(
        { error: 'unsupported_image_type', detail: `got ${f.type}` },
        { status: 400 },
      )
    }
    if (f.size > MAX_BYTES) {
      return NextResponse.json(
        { error: 'image_too_large', detail: `${Math.round(MAX_BYTES / 1024 / 1024)}MB max` },
        { status: 413 },
      )
    }
  }

  const scanId = randomUUID()
  const keyPrefix = `practice_${sess.practiceId}/patient_${sess.patientId}/${scanId}`
  const frontKey = frontFile ? `${keyPrefix}/front.jpg` : null
  const backKey = backFile ? `${keyPrefix}/back.jpg` : null

  let frontExtract: { fields: InsuranceCardFields; raw: AnalyzeFormsResult } | null = null
  let backExtract: { fields: InsuranceCardFields; raw: AnalyzeFormsResult } | null = null
  try {
    const tasks: Promise<void>[] = []
    if (frontFile && frontKey) {
      tasks.push((async () => {
        const bytes = new Uint8Array(await frontFile.arrayBuffer())
        await s3().send(new PutObjectCommand({
          Bucket: bucket,
          Key: frontKey,
          Body: bytes,
          ContentType: frontFile.type || 'image/jpeg',
          CacheControl: 'private, max-age=0, no-cache',
        }))
        const tx = await analyzeFormsFromBytes(bytes)
        frontExtract = { fields: extractInsuranceFields(tx), raw: tx }
      })())
    }
    if (backFile && backKey) {
      tasks.push((async () => {
        const bytes = new Uint8Array(await backFile.arrayBuffer())
        await s3().send(new PutObjectCommand({
          Bucket: bucket,
          Key: backKey,
          Body: bytes,
          ContentType: backFile.type || 'image/jpeg',
          CacheControl: 'private, max-age=0, no-cache',
        }))
        const tx = await analyzeFormsFromBytes(bytes)
        backExtract = { fields: extractInsuranceFields(tx), raw: tx }
      })())
    }
    await Promise.all(tasks)
  } catch (err) {
    console.error('[portal/insurance-card] scan failed:', (err as Error).message)
    return NextResponse.json(
      { error: 'scan_failed', detail: (err as Error).message },
      { status: 502 },
    )
  }

  const merged: InsuranceCardFields = mergeFields(
    frontExtract?.fields ?? {},
    backExtract?.fields ?? {},
  )
  const confidence = aggregateConfidence(merged)
  const lowConf = lowConfidenceFields(merged, REVIEW_THRESHOLD)
  const suggestedReview = lowConf.length > 0

  const scanData: Record<string, string> = {}
  const fieldConfidence: Record<string, number> = {}
  for (const k of INSURANCE_FIELD_KEYS) {
    const f = merged[k]
    if (f) {
      scanData[k] = f.value
      fieldConfidence[k] = f.confidence
    }
  }

  try {
    await pool.query(
      `INSERT INTO ehr_insurance_card_scans
         (id, practice_id, patient_id, scanned_by_user_id, scanned_by_role,
          front_s3_key, back_s3_key,
          scan_data, field_confidence, textract_raw, confidence)
       VALUES ($1, $2, $3, NULL, 'patient', $4, $5,
               $6::jsonb, $7::jsonb, $8::jsonb, $9)`,
      [
        scanId,
        sess.practiceId,
        sess.patientId,
        frontKey,
        backKey,
        JSON.stringify(scanData),
        JSON.stringify(fieldConfidence),
        JSON.stringify({
          front: frontExtract?.raw ?? null,
          back: backExtract?.raw ?? null,
        }),
        confidence,
      ],
    )
  } catch (err) {
    console.error('[portal/insurance-card] db insert failed:', (err as Error).message)
  }

  await auditPortalAccess({
    session: sess,
    action: 'portal.insurance_card.uploaded',
    resourceType: 'insurance_card_scan',
    resourceId: scanId,
    details: {
      fields_extracted_count: Object.keys(scanData).length,
      low_confidence_count: lowConf.length,
      front_uploaded: !!frontKey,
      back_uploaded: !!backKey,
    },
  })

  return NextResponse.json({
    scan_id: scanId,
    parsed_fields: scanData,
    field_confidence: fieldConfidence,
    confidence,
    suggested_review: suggestedReview,
    low_confidence_fields: lowConf,
  })
}

export async function GET() {
  // Return the current patient's most-recent self-uploaded scan so the
  // portal page can show review state. Therapist-captured scans are
  // hidden from the patient (they belong to the chart, not the
  // patient's view).
  const sess = await requirePortalSession()
  if (sess instanceof NextResponse) return sess

  const { rows } = await pool.query(
    `SELECT id, scan_data, field_confidence, confidence, created_at
       FROM ehr_insurance_card_scans
      WHERE patient_id = $1 AND practice_id = $2
        AND scanned_by_role = 'patient'
      ORDER BY created_at DESC
      LIMIT 1`,
    [sess.patientId, sess.practiceId],
  )

  if (rows.length > 0) {
    await auditPortalAccess({
      session: sess,
      action: 'portal.insurance_card.reviewed',
      resourceType: 'insurance_card_scan',
      resourceId: rows[0].id,
      details: {},
    })
  }

  return NextResponse.json({ scan: rows[0] || null })
}
