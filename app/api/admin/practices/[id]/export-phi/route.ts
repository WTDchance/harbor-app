// app/api/admin/practices/[id]/export-phi/route.ts
//
// Practice-wide PHI export — admin-initiated. Closes the gap from the
// Wave 38 practice decommission feature: decommission preserves PHI but
// there was no way to retrieve it. Also satisfies HIPAA right-of-
// portability when a practice or therapist leaves.
//
// Auth: requireAdminSession() — same gate as the decommission endpoint.
//
// Layout: ZIP contains a top-level practice.json + clinicians.json plus
// one folder per patient with the same per-patient layout as the
// single-patient export.
//
// Streaming: ZIP is streamed directly to S3 via archiver + PassThrough +
// @aws-sdk/lib-storage Upload, so we don't buffer the whole archive in
// memory. For practices with > 100 patients we return 202 with a TODO
// pointing at Wave 40 async processing — for v1 synchronous is fine.

import { NextResponse, type NextRequest } from 'next/server'
import { PassThrough } from 'stream'
import { requireAdminSession } from '@/lib/aws/api-auth'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
import { pool } from '@/lib/aws/db'
import {
  collectPatientPhi,
  buildPatientZip,
  presignExportUrl,
  newExportId,
  phiExportsBucket,
  countItems,
  type ItemCounts,
} from '@/lib/aws/ehr/phi-export'
import { S3Client } from '@aws-sdk/client-s3'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Practice-wide export can take a while; cap at 300s. If we exceed
// SYNC_PATIENT_LIMIT we 202 instead.
export const maxDuration = 300

const SYNC_PATIENT_LIMIT = 100

let _s3: S3Client | null = null
function s3(): S3Client {
  if (!_s3) _s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' })
  return _s3
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireAdminSession()
  if (ctx instanceof NextResponse) return ctx

  const { id: practiceId } = await params
  if (!practiceId) {
    return NextResponse.json({ error: 'practice_id_required' }, { status: 400 })
  }

  // ------------------------------------------------------------------
  // Inventory: practice profile + clinician list + patient ids.
  // ------------------------------------------------------------------
  const { rows: practiceRows } = await pool.query(
    `SELECT * FROM practices WHERE id = $1 LIMIT 1`,
    [practiceId],
  )
  const practice = practiceRows[0]
  if (!practice) {
    return NextResponse.json({ error: 'practice_not_found' }, { status: 404 })
  }

  const { rows: clinicianRows } = await pool.query(
    `SELECT id, email, name, role, is_active, created_at, updated_at
       FROM users
      WHERE practice_id = $1
      ORDER BY created_at ASC`,
    [practiceId],
  )

  const { rows: patientRows } = await pool.query(
    `SELECT id FROM patients WHERE practice_id = $1
      ORDER BY created_at ASC`,
    [practiceId],
  )
  const patientIds = patientRows.map(r => r.id as string)

  // v1 synchronous cap. 100+ patients → 202 with a marker.
  // Wave 40 will replace this with an SQS-driven async job.
  if (patientIds.length > SYNC_PATIENT_LIMIT) {
    return NextResponse.json(
      {
        status: 'accepted',
        async: true,
        patient_count: patientIds.length,
        message:
          'Practice exceeds the synchronous export threshold. ' +
          'Async processing is TODO Wave 40.',
      },
      { status: 202 },
    )
  }

  const exportId = newExportId()
  const exportedAt = new Date().toISOString()
  const exportedByEmail = ctx.session.email
  const key = `practice/${practiceId}/${exportId}.zip`
  const bucket = phiExportsBucket()
  if (!bucket) {
    return NextResponse.json(
      { error: 's3_phi_exports_bucket_not_configured' },
      { status: 500 },
    )
  }

  // ------------------------------------------------------------------
  // Stream ZIP -> PassThrough -> S3 multipart upload.
  // ------------------------------------------------------------------
  // archiver is dynamically required so this module compiles even when
  // the dep isn't yet installed in test environments. lib-storage's
  // Upload chunks the PassThrough into multipart parts as bytes flow.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const archiver = require('archiver') as typeof import('archiver')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Upload } = require('@aws-sdk/lib-storage') as typeof import('@aws-sdk/lib-storage')

  const passThrough = new PassThrough()
  const archive = archiver('zip', { zlib: { level: 9 } })
  archive.on('warning', (err: any) => {
    if (err.code !== 'ENOENT') console.error('[phi-export] archive warning:', err)
  })
  archive.on('error', (err: any) => {
    console.error('[phi-export] archive error:', err)
    passThrough.destroy(err)
  })
  archive.pipe(passThrough)

  const upload = new Upload({
    client: s3(),
    params: {
      Bucket: bucket,
      Key: key,
      Body: passThrough,
      ContentType: 'application/zip',
      ServerSideEncryption: 'aws:kms',
    },
    queueSize: 4,
    partSize: 8 * 1024 * 1024,
  })

  // ------------------------------------------------------------------
  // Append top-level practice.json + clinicians.json.
  // ------------------------------------------------------------------
  archive.append(JSON.stringify(practice, null, 2), { name: 'practice.json' })
  archive.append(JSON.stringify(clinicianRows, null, 2), { name: 'clinicians.json' })

  // Build per-patient ZIPs in-memory (jszip), then add as a single
  // archive.append call into the streaming archiver. This is the
  // simplest seam — we get streaming-to-S3 at the practice level while
  // keeping the per-patient ZIP composition in the shared library.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const JSZip = require('jszip')

  const totals: ItemCounts = {}
  const addCounts = (c: ItemCounts) => {
    for (const k of Object.keys(c)) {
      totals[k] = (totals[k] || 0) + c[k]
    }
  }

  for (const pid of patientIds) {
    const phi = await collectPatientPhi({ patientId: pid, practiceId })
    if (!phi) continue
    addCounts(countItems(phi))

    // Build a one-patient zip in-memory with no folder prefix, then
    // nest it under <patient_id>/ in the practice-wide archive.
    const patientZip = new JSZip()
    await buildPatientZip({
      exportId,
      exportedByEmail,
      patientId: pid,
      practiceId,
      phi,
      existingZip: patientZip,
    })
    const buf: Buffer = await patientZip.generateAsync({ type: 'nodebuffer' })

    // archiver doesn't know how to "merge" zips, so we re-walk the
    // patient zip and append each file under <pid>/.
    const reread: any = await JSZip.loadAsync(buf)
    const fileNames = Object.keys(reread.files).filter(n => !reread.files[n].dir)
    for (const name of fileNames) {
      const data: Buffer = await reread.files[name].async('nodebuffer')
      archive.append(data, { name: `${pid}/${name}` })
    }
  }

  // Practice-level README explaining the layout.
  archive.append(
    [
      `# Harbor PHI export — practice ${practiceId}`,
      ``,
      `**Export id:** ${exportId}`,
      `**Exported by:** ${exportedByEmail}`,
      `**Generated:** ${exportedAt}`,
      `**Patients included:** ${patientIds.length}`,
      ``,
      `Top-level files:`,
      `  - practice.json     practice profile`,
      `  - clinicians.json   user accounts on this practice`,
      ``,
      `Per-patient folders are keyed by patient UUID and contain the same`,
      `set of files that the single-patient export emits at its top level.`,
      ``,
      `Treat the contents of this archive as PHI.`,
      ``,
    ].join('\n'),
    { name: 'README.md' },
  )

  await archive.finalize()
  await upload.done()

  const url = await presignExportUrl({ key, ttlSeconds: 24 * 3600 })
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString()

  await auditEhrAccess({
    ctx,
    action: 'practice.phi.exported',
    resourceType: 'practice',
    resourceId: practiceId,
    details: {
      export_id: exportId,
      exported_at: exportedAt,
      s3_key: key,
      patient_count: patientIds.length,
      item_counts: totals,
    },
  })

  return NextResponse.json({
    url,
    expires_at: expiresAt,
    export_id: exportId,
    patient_count: patientIds.length,
    item_counts: totals,
  })
}
