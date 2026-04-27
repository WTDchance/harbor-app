// app/api/portal/superbills/[id]/route.ts
//
// Wave 40 / P5 — patient-portal per-id superbill PDF download.
// Wave 42 — snapshot replay (HIPAA hardening).
//
// Auth: requirePortalSession — the PATIENT themselves. Never a clinician
// masquerading. The query also constrains to sess.patientId so a session
// for one patient cannot read another's superbill even by guessing IDs.
//
// Behavior:
//   * If ehr_superbills.pdf_s3_key is set on the row, we replay the
//     therapist-side snapshot byte-for-byte from the KMS-encrypted
//     superbill-snapshots S3 bucket. SHA-256 is recomputed and compared
//     to pdf_sha256; mismatch fires the
//     billing.superbill.snapshot_integrity_failure event (severity
//     critical) and the route 500s. The patient gets the EXACT bytes the
//     therapist's snapshot has — same audit trail, same legal record.
//   * If pdf_s3_key is NULL (legacy row from before Wave 42, or therapist
//     hasn't downloaded a PDF yet) we fall back to live render so the
//     patient is not stranded, then seed the snapshot so future downloads
//     replay. Audits snapshot_created in that case.
//   * Patient can NOT trigger ?regenerate=true — admin-only on therapist
//     side.
//
// HIPAA notes inline: KMS at rest, 7-year retention, SHA-256 integrity
// check on replay, S3 versioning for tamper detection, audit log rows on
// every lifecycle event. API contract is unchanged.

import { NextResponse, type NextRequest } from 'next/server'
import { requirePortalSession } from '@/lib/aws/portal-auth'
import { pool } from '@/lib/aws/db'
import { auditPortalAccess } from '@/lib/aws/ehr/audit'
import { renderSuperbillPdf, type SuperbillLineItem } from '@/lib/ehr/superbill'
import {
  putSuperbillSnapshot,
  getSuperbillSnapshot,
  sha256Hex,
} from '@/lib/aws/ehr/superbill-snapshots'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const sess = await requirePortalSession()
  if (sess instanceof NextResponse) return sess
  const { id: superbillId } = await params

  const sb = await pool.query(
    `SELECT id, from_date, to_date, total_cents, generated_at,
            pdf_s3_key, pdf_sha256, pdf_size_bytes
       FROM ehr_superbills
      WHERE id = $1
        AND practice_id = $2
        AND patient_id  = $3
      LIMIT 1`,
    [superbillId, sess.practiceId, sess.patientId],
  )
  if (sb.rows.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  const row = sb.rows[0]
  const from = String(row.from_date).slice(0, 10)
  const to = String(row.to_date).slice(0, 10)

  // ---- REPLAY PATH ----------------------------------------------------
  if (row.pdf_s3_key) {
    try {
      const bytes = await getSuperbillSnapshot(row.pdf_s3_key)
      const computed = sha256Hex(bytes)
      if (computed !== row.pdf_sha256) {
        await auditPortalAccess({
          session: sess,
          action: 'billing.superbill.snapshot_integrity_failure',
          resourceType: 'ehr_superbill',
          resourceId: row.id,
          details: {
            pdf_s3_key: row.pdf_s3_key,
            expected_sha256: row.pdf_sha256,
            computed_sha256: computed,
            expected_size_bytes: row.pdf_size_bytes,
            actual_size_bytes: bytes.byteLength,
            severity: 'critical',
            surface: 'portal',
          },
        }).catch(() => {})
        return NextResponse.json(
          { error: 'snapshot_integrity_failure' },
          { status: 500 },
        )
      }
      await auditPortalAccess({
        session: sess,
        action: 'billing.superbill.snapshot_replayed',
        resourceType: 'ehr_superbill',
        resourceId: row.id,
        details: { pdf_s3_key: row.pdf_s3_key, size_bytes: bytes.byteLength, surface: 'portal' },
      }).catch(() => {})
      // Backwards-compat audit so the legacy portal.superbill.download
      // metric on the patient surface keeps reporting.
      await auditPortalAccess({
        session: sess,
        action: 'portal.superbill.download',
        resourceType: 'ehr_superbill',
        resourceId: superbillId,
        details: { from, to, format: 'pdf', replayed: true },
      }).catch(() => {})

      const filename = `superbill-${from}-to-${to}.pdf`
      return new NextResponse(bytes, {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Cache-Control': 'private, no-store',
        },
      })
    } catch (err: any) {
      console.error('[portal.superbill] snapshot fetch failed:', err?.message)
      await auditPortalAccess({
        session: sess,
        action: 'billing.superbill.snapshot_integrity_failure',
        resourceType: 'ehr_superbill',
        resourceId: row.id,
        details: {
          pdf_s3_key: row.pdf_s3_key,
          fetch_error: String(err?.message || err),
          severity: 'critical',
          surface: 'portal',
        },
      }).catch(() => {})
      return NextResponse.json(
        { error: 'snapshot_integrity_failure' },
        { status: 500 },
      )
    }
  }

  // ---- LIVE RENDER + SEED PATH (legacy row only) ---------------------
  // Same shape as /api/portal/superbill/pdf — patient-scoped reads only.
  const [practiceRes, patientRes, chargesRes, paymentsRes] = await Promise.all([
    pool.query(
      `SELECT name, billing_tax_id, billing_npi, billing_address, phone_number,
              email, address_line1, address_line2, city, state, zip
         FROM practices WHERE id = $1 LIMIT 1`,
      [sess.practiceId],
    ).catch(() => ({ rows: [] as any[] })),
    pool.query(
      `SELECT first_name, last_name, date_of_birth,
              address_line1, city, state, zip
         FROM patients WHERE id = $1 LIMIT 1`,
      [sess.patientId],
    ),
    pool.query(
      `SELECT id, cpt_code, units, fee_cents, allowed_cents,
              service_date, note_id
         FROM ehr_charges
        WHERE practice_id = $1 AND patient_id = $2
          AND service_date >= $3::date AND service_date <= $4::date
        ORDER BY service_date ASC`,
      [sess.practiceId, sess.patientId, from, to],
    ),
    pool.query(
      `SELECT charge_id, COALESCE(SUM(amount_cents), 0) AS paid_cents
         FROM ehr_payments
        WHERE practice_id = $1 AND patient_id = $2
          AND received_at::date >= $3::date AND received_at::date <= $4::date
          AND charge_id IS NOT NULL
        GROUP BY charge_id`,
      [sess.practiceId, sess.patientId, from, to],
    ).catch(() => ({ rows: [] as any[] })),
  ])

  const practice = practiceRes.rows[0]
  const patient = patientRes.rows[0]
  if (!patient) return NextResponse.json({ error: 'Patient not found' }, { status: 404 })

  const charges = chargesRes.rows
  const paidByCharge = new Map<string, number>()
  for (const p of paymentsRes.rows) paidByCharge.set(p.charge_id, Number(p.paid_cents))

  const noteIds = charges.map((r: any) => r.note_id).filter(Boolean)
  let icdByNote = new Map<string, string[]>()
  if (noteIds.length > 0) {
    const { rows: notes } = await pool.query(
      `SELECT id, icd10_codes FROM ehr_progress_notes WHERE id = ANY($1::uuid[])`,
      [noteIds],
    ).catch(() => ({ rows: [] as any[] }))
    icdByNote = new Map(notes.map((n: any) => [n.id, n.icd10_codes || []]))
  }

  const lineItems: SuperbillLineItem[] = charges.map((r: any) => ({
    service_date: r.service_date,
    cpt_code: r.cpt_code,
    icd10_codes: icdByNote.get(r.note_id) ?? [],
    fee_cents: Number(r.fee_cents),
    paid_cents: paidByCharge.get(r.id) ?? Number(r.allowed_cents),
  }))

  const bytes = await renderSuperbillPdf({
    practice: {
      name: practice?.name ?? 'Therapy Practice',
      address_line1: practice?.address_line1 ?? practice?.billing_address ?? null,
      address_line2: practice?.address_line2 ?? null,
      city: practice?.city ?? null,
      state: practice?.state ?? null,
      zip: practice?.zip ?? null,
      phone: practice?.phone_number ?? null,
      email: practice?.email ?? null,
      npi: practice?.billing_npi ?? null,
      tax_id: practice?.billing_tax_id ?? null,
    },
    patient: {
      first_name: patient.first_name ?? null,
      last_name: patient.last_name ?? null,
      dob: patient.date_of_birth ?? null,
      address_line1: patient.address_line1 ?? null,
      city: patient.city ?? null,
      state: patient.state ?? null,
      zip: patient.zip ?? null,
    },
    range_start: from,
    range_end: to,
    generated_at: new Date(row.generated_at).toISOString(),
    line_items: lineItems,
  })
  const buf = Buffer.from(bytes)

  // Seed the snapshot so future downloads replay the same bytes. The
  // patient is NEVER given regenerate authority — but seeding a missing
  // snapshot is exactly the first-creation path.
  let snapshotMeta: { key: string; sha256: string; size: number } | null = null
  try {
    snapshotMeta = await putSuperbillSnapshot({
      practiceId: sess.practiceId,
      patientId: sess.patientId,
      superbillId,
      pdf: buf,
    })
    await pool.query(
      `UPDATE ehr_superbills
          SET pdf_s3_key       = $1,
              pdf_generated_at = NOW(),
              pdf_size_bytes   = $2,
              pdf_sha256       = $3
        WHERE id = $4`,
      [snapshotMeta.key, snapshotMeta.size, snapshotMeta.sha256, superbillId],
    )
    await auditPortalAccess({
      session: sess,
      action: 'billing.superbill.snapshot_created',
      resourceType: 'ehr_superbill',
      resourceId: superbillId,
      details: {
        from, to, line_count: lineItems.length,
        pdf_s3_key: snapshotMeta.key,
        pdf_sha256: snapshotMeta.sha256,
        pdf_size_bytes: snapshotMeta.size,
        surface: 'portal',
      },
    }).catch(() => {})
  } catch (err: any) {
    console.error('[portal.superbill] snapshot seed failed:', err?.message)
  }

  // Backwards-compat audit so existing portal metrics keep reporting.
  await auditPortalAccess({
    session: sess,
    action: 'portal.superbill.download',
    resourceType: 'ehr_superbill',
    resourceId: superbillId,
    details: {
      from, to, line_count: lineItems.length, format: 'pdf',
      pdf_s3_key: snapshotMeta?.key ?? null,
    },
  }).catch(() => {})

  const filename = `superbill-${patient.last_name ?? 'self'}-${from}-to-${to}.pdf`.replace(/\s+/g, '_')
  return new NextResponse(buf, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
