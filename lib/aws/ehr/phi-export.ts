// lib/aws/ehr/phi-export.ts
//
// Shared helpers for the PHI-export feature.
//
//   * collectPatientPhi    — query everything for one patient, gracefully
//                            skipping tables that don't exist yet.
//   * buildPatientZip      — emit a structured ZIP (in-memory) containing
//                            JSON, PNG signatures, a printable PDF of the
//                            progress notes, and a README.md.
//   * uploadExportToS3     — put a Buffer into the PHI-export bucket.
//   * presignExportUrl     — mint a 24h GET URL for the caller.
//   * countItems           — small helper for audit-log metadata.
//
// The bucket is `harbor-staging-phi-exports-<account>`, KMS-encrypted, with
// a 7-day lifecycle expiry. Object keys are namespaced by export id so
// per-patient and per-practice exports never collide.
//
// We do NOT touch comms (Twilio/Vapi) here — this feature is data-export
// only. Stack: AWS S3, AWS KMS, pdf-lib, jszip.

import crypto from 'crypto'
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { pool } from '@/lib/aws/db'
import { PART2_REDISCLOSURE_NOTICE } from '@/lib/aws/ehr/part2'

let _client: S3Client | null = null
function s3(): S3Client {
  if (!_client) _client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' })
  return _client
}

export function phiExportsBucket(): string {
  return (
    process.env.S3_PHI_EXPORTS_BUCKET ||
    `harbor-staging-phi-exports-${process.env.AWS_ACCOUNT_ID || ''}`
  )
}

/** Stable random id we can include in the audit log + S3 key. */
export function newExportId(): string {
  return crypto.randomBytes(12).toString('hex')
}

/**
 * Returns true if the given table exists in the current Postgres schema.
 * Used to gracefully skip Wave-39-pending tables that may not yet exist
 * (mental_status_exams, discharge_summaries, treatment_plan_reviews).
 */
async function tableExists(name: string): Promise<boolean> {
  try {
    const { rows } = await pool.query(`SELECT to_regclass($1) AS oid`, [`public.${name}`])
    return !!rows[0]?.oid
  } catch {
    return false
  }
}

async function safeRows(table: string, sql: string, args: unknown[]): Promise<any[]> {
  if (!(await tableExists(table))) return []
  try {
    const { rows } = await pool.query(sql, args)
    return rows
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[phi-export] failed to read ${table}:`, (err as Error).message)
    return []
  }
}

export type PatientPhi = {
  patient: any
  appointments: any[]
  progress_notes: any[]
  treatment_plans: any[]
  treatment_plan_reviews: any[]
  assessments: any[]
  mental_status_exams: any[]
  discharge_summaries: any[]
  safety_plans: any[]
  consent_signatures: any[]
  mandatory_reports: any[]
  insurance_verifications: any[]
  prescriptions: any[]
  audit_logs: any[]
}

export async function collectPatientPhi(args: {
  patientId: string
  practiceId: string
}): Promise<PatientPhi | null> {
  const { patientId, practiceId } = args

  const { rows: patientRows } = await pool.query(
    `SELECT * FROM patients WHERE id = $1 AND practice_id = $2 LIMIT 1`,
    [patientId, practiceId],
  )
  const patient = patientRows[0]
  if (!patient) return null

  const [
    appts, notes, plans, planReviews, assess, mses, discharges,
    safety, consents, mandReports, insur, rxs, audits,
  ] = await Promise.all([
    safeRows('appointments',
      `SELECT * FROM appointments WHERE practice_id = $1 AND patient_id = $2
        ORDER BY scheduled_for DESC NULLS LAST`, [practiceId, patientId]),
    safeRows('ehr_progress_notes',
      `SELECT * FROM ehr_progress_notes WHERE practice_id = $1 AND patient_id = $2
        ORDER BY created_at DESC`, [practiceId, patientId]),
    safeRows('ehr_treatment_plans',
      `SELECT * FROM ehr_treatment_plans WHERE practice_id = $1 AND patient_id = $2
        ORDER BY created_at DESC`, [practiceId, patientId]),
    safeRows('ehr_treatment_plan_reviews',
      `SELECT * FROM ehr_treatment_plan_reviews WHERE practice_id = $1 AND patient_id = $2
        ORDER BY created_at DESC`, [practiceId, patientId]),
    safeRows('patient_assessments',
      `SELECT * FROM patient_assessments WHERE practice_id = $1 AND patient_id = $2
        ORDER BY completed_at DESC NULLS LAST`, [practiceId, patientId]),
    safeRows('ehr_mental_status_exams',
      `SELECT * FROM ehr_mental_status_exams WHERE practice_id = $1 AND patient_id = $2
        ORDER BY created_at DESC`, [practiceId, patientId]),
    safeRows('ehr_discharge_summaries',
      `SELECT * FROM ehr_discharge_summaries WHERE practice_id = $1 AND patient_id = $2
        ORDER BY created_at DESC`, [practiceId, patientId]),
    safeRows('ehr_safety_plans',
      `SELECT * FROM ehr_safety_plans WHERE practice_id = $1 AND patient_id = $2
        ORDER BY created_at DESC`, [practiceId, patientId]),
    safeRows('ehr_consents',
      `SELECT * FROM ehr_consents WHERE practice_id = $1 AND patient_id = $2
        ORDER BY created_at DESC`, [practiceId, patientId]),
    safeRows('ehr_mandatory_reports',
      `SELECT * FROM ehr_mandatory_reports WHERE practice_id = $1 AND patient_id = $2
        ORDER BY created_at DESC`, [practiceId, patientId]),
    safeRows('insurance_verifications',
      `SELECT * FROM insurance_verifications WHERE practice_id = $1 AND patient_id = $2
        ORDER BY created_at DESC`, [practiceId, patientId]),
    safeRows('ehr_prescriptions',
      `SELECT * FROM ehr_prescriptions WHERE practice_id = $1 AND patient_id = $2
        ORDER BY created_at DESC`, [practiceId, patientId]),
    safeRows('audit_logs',
      `SELECT * FROM audit_logs
        WHERE practice_id = $1
          AND (resource_id = $2 OR (details->>'patient_id') = $2)
        ORDER BY created_at DESC LIMIT 5000`, [practiceId, patientId]),
  ])

  return {
    patient,
    appointments: appts,
    progress_notes: notes,
    treatment_plans: plans,
    treatment_plan_reviews: planReviews,
    assessments: assess,
    mental_status_exams: mses,
    discharge_summaries: discharges,
    safety_plans: safety,
    consent_signatures: consents,
    mandatory_reports: mandReports,
    insurance_verifications: insur,
    prescriptions: rxs,
    audit_logs: audits,
  }
}

export type ItemCounts = Record<string, number>

export function countItems(phi: PatientPhi): ItemCounts {
  return {
    appointments: phi.appointments.length,
    progress_notes: phi.progress_notes.length,
    treatment_plans: phi.treatment_plans.length,
    treatment_plan_reviews: phi.treatment_plan_reviews.length,
    assessments: phi.assessments.length,
    mental_status_exams: phi.mental_status_exams.length,
    discharge_summaries: phi.discharge_summaries.length,
    safety_plans: phi.safety_plans.length,
    consent_signatures: phi.consent_signatures.length,
    mandatory_reports: phi.mandatory_reports.length,
    insurance_verifications: phi.insurance_verifications.length,
    prescriptions: phi.prescriptions.length,
    audit_logs: phi.audit_logs.length,
  }
}

/** Render the full set of progress notes as a single, simple PDF. */
export async function renderProgressNotesPdf(args: {
  patient: any
  notes: any[]
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const black = rgb(0, 0, 0)
  const gray = rgb(0.4, 0.4, 0.4)

  const { patient, notes } = args
  const name = `${patient?.first_name ?? ''} ${patient?.last_name ?? ''}`.trim() || 'Patient'

  const wrap = (text: string, width: number, f = font, size = 10): string[] => {
    const out: string[] = []
    for (const para of String(text ?? '').split(/\r?\n/)) {
      let line = ''
      for (const word of para.split(/\s+/)) {
        const trial = line ? `${line} ${word}` : word
        if (f.widthOfTextAtSize(trial, size) <= width) line = trial
        else { if (line) out.push(line); line = word }
      }
      out.push(line)
    }
    return out
  }

  let page = doc.addPage([612, 792])
  let y = 760
  const left = 50, right = 562, lineH = 13

  const ensureRoom = (need: number) => {
    if (y - need < 50) { page = doc.addPage([612, 792]); y = 760 }
  }

  page.drawText(`Progress notes — ${name}`, { x: left, y, size: 16, font: bold, color: black })
  y -= 20
  page.drawText(`Exported ${new Date().toISOString()}`, { x: left, y, size: 9, font, color: gray })
  y -= 20

  if (notes.length === 0) {
    page.drawText('No progress notes on file.', { x: left, y, size: 11, font, color: black })
    return doc.save()
  }

  for (const n of notes) {
    ensureRoom(40)
    const dt = n.session_date || n.created_at || ''
    const fmt = n.note_format || n.format || ''
    const header = `${dt}${fmt ? ' · ' + fmt : ''}${n.signed_at ? ' · signed' : ''}`
    page.drawText(String(header), { x: left, y, size: 11, font: bold, color: black })
    y -= lineH + 2

    const body =
      n.body_text || n.body ||
      [n.subjective, n.objective, n.assessment, n.plan].filter(Boolean).join('\n\n') ||
      n.content_text || ''
    const lines = wrap(body, right - left)
    for (const line of lines) {
      ensureRoom(lineH)
      page.drawText(line, { x: left, y, size: 10, font, color: black })
      y -= lineH
    }
    y -= 8
    ensureRoom(2)
    page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 0.5, color: gray })
    y -= 12
  }

  return doc.save()
}

/**
 * Build a per-patient ZIP. JSZip is a dynamic require so the module can be
 * compiled even if the dep isn't yet installed in some environments.
 */
export async function buildPatientZip(args: {
  exportId: string
  exportedByEmail: string
  patientId: string
  practiceId: string
  phi: PatientPhi
  /** When set, write all entries under `<folderPrefix>/`. Used by the
   *  practice-wide export so each patient lives in its own folder. */
  folderPrefix?: string
  /** When provided, the caller has already created a JSZip and wants us to
   *  add this patient's files into it. */
  existingZip?: any
}): Promise<Buffer | null> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const JSZip = require('jszip')
  const zip = args.existingZip ?? new JSZip()
  const root = args.folderPrefix ? `${args.folderPrefix}/` : ''

  zip.file(
    `${root}patient.json`,
    JSON.stringify({ id: args.phi.patient.id, profile: args.phi.patient }, null, 2),
  )
  zip.file(`${root}appointments.json`, JSON.stringify(args.phi.appointments, null, 2))

  const notesFolder = zip.folder(`${root}progress-notes`)!
  for (const n of args.phi.progress_notes) {
    notesFolder.file(`${n.id}.json`, JSON.stringify(n, null, 2))
  }
  const notesPdf = await renderProgressNotesPdf({
    patient: args.phi.patient, notes: args.phi.progress_notes,
  })
  zip.file(`${root}progress-notes.pdf`, notesPdf)

  const tpFolder = zip.folder(`${root}treatment-plans`)!
  for (const tp of args.phi.treatment_plans) {
    tpFolder.file(`${tp.id}.json`, JSON.stringify(tp, null, 2))
  }
  if (args.phi.treatment_plan_reviews.length) {
    zip.file(`${root}treatment-plan-reviews.json`,
      JSON.stringify(args.phi.treatment_plan_reviews, null, 2))
  }

  const aFolder = zip.folder(`${root}assessments`)!
  for (const a of args.phi.assessments) {
    aFolder.file(`${a.id}.json`, JSON.stringify(a, null, 2))
  }

  if (args.phi.mental_status_exams.length) {
    zip.file(`${root}mental-status-exams.json`,
      JSON.stringify(args.phi.mental_status_exams, null, 2))
  }
  if (args.phi.discharge_summaries.length) {
    zip.file(`${root}discharge-summaries.json`,
      JSON.stringify(args.phi.discharge_summaries, null, 2))
  }

  zip.file(`${root}safety-plan.json`, JSON.stringify(args.phi.safety_plans, null, 2))

  zip.file(`${root}consent-signatures.json`,
    JSON.stringify(args.phi.consent_signatures, null, 2))
  const sigFolder = zip.folder(`${root}consent-signatures`)!
  for (const c of args.phi.consent_signatures) {
    const sig: string | undefined =
      c.signature_image_data_url || c.signature_png_base64 || c.signature_data_url
    if (!sig) continue
    const m = /^data:image\/png;base64,(.+)$/.exec(sig)
    const b64 = m ? m[1] : sig
    try { sigFolder.file(`${c.id}.png`, Buffer.from(b64, 'base64')) } catch { /* ignore */ }
  }

  if (args.phi.mandatory_reports.length) {
    const mrFolder = zip.folder(`${root}mandatory-reports`)!
    for (const r of args.phi.mandatory_reports) {
      mrFolder.file(`${r.id}.json`, JSON.stringify(r, null, 2))
    }
  }

  if (args.phi.insurance_verifications.length) {
    zip.file(`${root}insurance-verifications.json`,
      JSON.stringify(args.phi.insurance_verifications, null, 2))
  }
  if (args.phi.prescriptions.length) {
    zip.file(`${root}prescriptions.json`,
      JSON.stringify(args.phi.prescriptions, null, 2))
  }

  zip.file(`${root}audit-log.json`, JSON.stringify(args.phi.audit_logs, null, 2))

  zip.file(
    `${root}README.md`,
    [
      `# 42 CFR Part 2 — Notice Prohibiting Re-disclosure`,
      ``,
      `> ${PART2_REDISCLOSURE_NOTICE}`,
      ``,
      `---`,
      ``,
      `# Harbor PHI export`,
      ``,
      `**Patient id:** ${args.patientId}`,
      `**Practice id:** ${args.practiceId}`,
      `**Export id:** ${args.exportId}`,
      `**Exported by:** ${args.exportedByEmail}`,
      `**Generated:** ${new Date().toISOString()}`,
      ``,
      `This archive contains a complete copy of the patient's clinical data on file.`,
      `JSON files are the canonical, machine-readable form. \`progress-notes.pdf\` is`,
      `a printable rendering of the same notes.`,
      ``,
      `Treat the contents of this ZIP as PHI. Store and transmit accordingly.`,
      ``,
    ].join('\n'),
  )

  if (args.existingZip) return null
  return zip.generateAsync({ type: 'nodebuffer' })
}

export async function uploadExportToS3(args: {
  key: string
  body: Buffer
}): Promise<void> {
  const bucket = phiExportsBucket()
  if (!bucket) throw new Error('S3_PHI_EXPORTS_BUCKET not configured')
  await s3().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: args.key,
      Body: args.body,
      ContentType: 'application/zip',
      ServerSideEncryption: 'aws:kms',
    }),
  )
}

export async function presignExportUrl(args: {
  key: string
  ttlSeconds?: number
}): Promise<string> {
  const bucket = phiExportsBucket()
  if (!bucket) throw new Error('S3_PHI_EXPORTS_BUCKET not configured')
  return getSignedUrl(
    s3(),
    new GetObjectCommand({ Bucket: bucket, Key: args.key }),
    { expiresIn: args.ttlSeconds ?? 24 * 3600 },
  )
}
