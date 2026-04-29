// app/api/ehr/patients/[id]/insurance-card/route.ts
//
// Wave 42 — insurance-card scanner backend.
//
// Therapist taps "Update from card" in the patient profile, snaps the
// front (and optionally back) of the patient's insurance card with the
// phone camera, and POSTs the images here as multipart/form-data. We:
//
//   1. Verify the caller has a Cognito session AND belongs to the
//      patient's practice (cross-practice access => 404, never 403,
//      to avoid confirming the patient exists in another practice).
//   2. Upload each image to the dedicated insurance-cards S3 bucket
//      (KMS-encrypted, see infra/terraform/insurance-card-scans-bucket.tf).
//      Object key: `practice_<id>/patient_<id>/<scan_id>/<side>.jpg`.
//   3. Run Textract AnalyzeDocument with FeatureTypes=['FORMS'] over
//      each image. We use AnalyzeDocument (not AnalyzeID — that's for
//      government IDs, which insurance cards are not).
//   4. Map Textract KEY_VALUE_SET output to canonical fields (member
//      ID, group, payer, RX BIN/PCN/Group, phones, ...) using the
//      synonym + regex sweep in lib/aws/ehr/insurance-card/parse.ts.
//   5. Persist parsed fields + raw Textract response + S3 keys into
//      ehr_insurance_card_scans. (The patient row's insurance_*
//      columns remain the source of truth — those are written when
//      the therapist hits Save in the frontend, not here.)
//   6. Return scan_id, parsed_fields, aggregate confidence, S3 keys,
//      and suggested_review=true if any field is below 0.85 confidence.
//   7. Audit log: action='insurance_card.scanned', target patient,
//      metadata = { scan_id, fields_extracted, low_confidence_fields }.
//
// HIPAA notes:
//   * Textract is HIPAA-eligible under Harbor's existing AWS BAA.
//   * Original images live only in the KMS-encrypted insurance-cards
//     bucket (90d hot, then Glacier).
//   * No images leave AWS — Textract is called inside the same account.
//   * Every scan is audited via lib/aws/ehr/audit.ts.

import { NextResponse, type NextRequest } from 'next/server'
import { randomUUID } from 'crypto'
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'

import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
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
// Two Textract calls + two S3 uploads can take a while on a slow phone connection.
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

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  if (!ctx.practiceId) {
    return NextResponse.json({ error: 'practice_required' }, { status: 403 })
  }

  const bucket = insuranceCardsBucket()
  if (!bucket) {
    return NextResponse.json(
      { error: 'insurance_cards_bucket_not_configured' },
      { status: 500 },
    )
  }

  const { id: patientId } = await params
  if (!patientId) {
    return NextResponse.json({ error: 'patient_id_required' }, { status: 400 })
  }

  // Confirm patient exists in caller's practice. 404 (not 403) on cross-
  // practice reads so we never leak existence.
  const patientRow = await pool
    .query<{ id: string }>(
      `SELECT id FROM patients WHERE id = $1 AND practice_id = $2`,
      [patientId, ctx.practiceId],
    )
    .then(r => r.rows[0])
    .catch(() => undefined)
  if (!patientRow) {
    return NextResponse.json({ error: 'patient_not_found' }, { status: 404 })
  }

  // Parse multipart form.
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
      { error: 'at_least_one_image_required', detail: 'expected card_front and/or card_back' },
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

  // Mint scan id; build S3 keys per spec.
  const scanId = randomUUID()
  const keyPrefix = `practice_${ctx.practiceId}/patient_${patientId}/${scanId}`
  const frontKey = frontFile ? `${keyPrefix}/front.jpg` : null
  const backKey = backFile ? `${keyPrefix}/back.jpg` : null

  // Upload originals + run Textract per side. Front and back are
  // independent — do them in parallel to keep the user-facing latency
  // low (this is a phone UX, every second counts).
  type Extract = { fields: InsuranceCardFields; raw: AnalyzeFormsResult }
  let frontExtract = null as Extract | null
  let backExtract = null as Extract | null
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
    console.error('[insurance-card] upload/textract failed:', (err as Error).message)
    return NextResponse.json(
      { error: 'scan_failed', detail: (err as Error).message },
      { status: 502 },
    )
  }

  // Merge front + back extractions. RX BIN/PCN/phones tend to be on the
  // back; member ID / payer / plan tend to be on the front. mergeFields
  // takes the higher-confidence value per field.
  const merged: InsuranceCardFields = mergeFields(
    frontExtract?.fields ?? {},
    backExtract?.fields ?? {},
  )
  const confidence = aggregateConfidence(merged)
  const lowConf = lowConfidenceFields(merged, REVIEW_THRESHOLD)
  const suggestedReview = lowConf.length > 0

  // Flatten merged into the JSONB-shaped scan_data + field_confidence the
  // table expects (one map of value, one of confidence — keyed identically).
  const scanData: Record<string, string> = {}
  const fieldConfidence: Record<string, number> = {}
  for (const k of INSURANCE_FIELD_KEYS) {
    const f = merged[k]
    if (f) {
      scanData[k] = f.value
      fieldConfidence[k] = f.confidence
    }
  }

  // Persist scan row. We don't fail the whole request if the insert
  // fails — the therapist still gets the parsed fields back and can
  // edit/save them via the patient edit form. But we log + audit so
  // the broken DB write is visible.
  try {
    await pool.query(
      `INSERT INTO ehr_insurance_card_scans
         (id, practice_id, patient_id, scanned_by_user_id,
          front_s3_key, back_s3_key,
          scan_data, field_confidence, textract_raw, confidence)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10)`,
      [
        scanId,
        ctx.practiceId,
        patientId,
        ctx.user.id,
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
    console.error('[insurance-card] db insert failed:', (err as Error).message)
  }

  // Audit. Fields list is just keys, no values — the values are PHI and
  // we don't replicate them into audit_logs.details.
  await auditEhrAccess({
    ctx,
    action: 'insurance_card.scanned',
    resourceType: 'insurance_card_scan',
    resourceId: scanId,
    details: {
      scan_id: scanId,
      target_patient_id: patientId,
      fields_extracted: Object.keys(scanData),
      low_confidence_fields: lowConf,
      front_uploaded: !!frontKey,
      back_uploaded: !!backKey,
    },
  })

  return NextResponse.json({
    scan_id: scanId,
    parsed_fields: scanData,
    field_confidence: fieldConfidence,
    confidence,
    original_s3_keys: {
      front: frontKey,
      back: backKey,
    },
    suggested_review: suggestedReview,
    low_confidence_fields: lowConf,
  })
}
