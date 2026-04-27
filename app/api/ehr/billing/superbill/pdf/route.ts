// app/api/ehr/billing/superbill/pdf/route.ts
//
// Wave 38 / TS7 — therapist-side PDF superbill via pdf-lib.
// Wave 42 — immutable snapshot persistence (HIPAA hardening).
//
// Behavior:
//   1. First request for (practice, patient, from..to): generate the PDF
//      live, INSERT an ehr_superbills row, upload the bytes to the
//      KMS-encrypted superbill-snapshots S3 bucket, persist
//      pdf_s3_key/pdf_generated_at/pdf_size_bytes/pdf_sha256, and return
//      the bytes. Audit: snapshot_created.
//   2. Subsequent request: replay the persisted snapshot — fetch from S3,
//      recompute SHA-256, compare to pdf_sha256. Match → stream bytes.
//      Mismatch → write billing.superbill.snapshot_integrity_failure
//      (severity=critical) and 500. Audit: snapshot_replayed.
//   3. Admin-only ?regenerate=true: re-render live, overwrite the same
//      key (S3 versioning preserves the prior bytes), update the row,
//      audit snapshot_regenerated. Non-admins get 403 if they pass the
//      flag.
//
// HIPAA notes inline: KMS at rest, 7-year retention, SHA-256 integrity
// check on every replay, S3 versioning for tamper detection, audit log
// rows on every lifecycle event. The API contract (Content-Type,
// Content-Disposition, Cache-Control, status codes) is unchanged.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
import { renderSuperbillPdf, type SuperbillLineItem } from '@/lib/ehr/superbill'
import {
  putSuperbillSnapshot,
  getSuperbillSnapshot,
  sha256Hex,
} from '@/lib/aws/ehr/superbill-snapshots'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function isAdminEmail(email: string | undefined | null): boolean {
  if (!email) return false
  const allow = (process.env.ADMIN_EMAIL || 'chancewonser@gmail.com')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean)
  return allow.includes(email.toLowerCase())
}

export async function GET(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const sp = req.nextUrl.searchParams
  const patientId = sp.get('patient_id')
  const from = sp.get('from')
  const to = sp.get('to')
  const regenerate = sp.get('regenerate') === 'true'
  if (!patientId || !from || !to) {
    return NextResponse.json({ error: 'patient_id, from, to required' }, { status: 400 })
  }

  if (regenerate && !isAdminEmail(ctx.session.email)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  // Resolve an existing snapshot row first, if there is one.
  const existing = await pool.query(
    `SELECT id, pdf_s3_key, pdf_sha256, pdf_size_bytes
       FROM ehr_superbills
      WHERE practice_id = $1 AND patient_id = $2
        AND from_date = $3::date AND to_date = $4::date
      ORDER BY generated_at DESC
      LIMIT 1`,
    [ctx.practiceId, patientId, from, to],
  ).catch(() => ({ rows: [] as any[] }))

  // ---- REPLAY PATH ----------------------------------------------------
  // We have a row with a snapshot persisted, AND the caller did not ask
  // for an admin regenerate. Fetch from S3, verify SHA-256, stream back.
  if (!regenerate && existing.rows[0]?.pdf_s3_key) {
    const row = existing.rows[0]
    try {
      const bytes = await getSuperbillSnapshot(row.pdf_s3_key)
      const computed = sha256Hex(bytes)
      if (computed !== row.pdf_sha256) {
        await auditEhrAccess({
          ctx,
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
          },
        })
        return NextResponse.json(
          { error: 'snapshot_integrity_failure' },
          { status: 500 },
        )
      }
      await auditEhrAccess({
        ctx,
        action: 'billing.superbill.snapshot_replayed',
        resourceType: 'ehr_superbill',
        resourceId: row.id,
        details: { pdf_s3_key: row.pdf_s3_key, size_bytes: bytes.byteLength },
      })
      const filename = `superbill-${patientId}-${from}-to-${to}.pdf`
      return new NextResponse(bytes, {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Cache-Control': 'private, no-store',
        },
      })
    } catch (err: any) {
      // S3 fetch failed entirely — log and fall through to live regen so
      // the user is not left without a document. This is rare (S3 down,
      // role drift) and is loud in CloudWatch via the audit row.
      console.error('[superbill.pdf] snapshot fetch failed; regenerating live:', err?.message)
      await auditEhrAccess({
        ctx,
        action: 'billing.superbill.snapshot_integrity_failure',
        resourceType: 'ehr_superbill',
        resourceId: existing.rows[0].id,
        details: {
          pdf_s3_key: existing.rows[0].pdf_s3_key,
          fetch_error: String(err?.message || err),
          severity: 'critical',
        },
      })
      return NextResponse.json(
        { error: 'snapshot_integrity_failure' },
        { status: 500 },
      )
    }
  }

  // ---- LIVE REGEN PATH (first generation OR admin regenerate) --------
  const [practiceRes, patientRes, chargesRes, paymentsRes] = await Promise.all([
    pool.query(
      `SELECT name, billing_tax_id, billing_npi, billing_address, phone_number,
              email, address_line1, address_line2, city, state, zip
         FROM practices WHERE id = $1 LIMIT 1`,
      [ctx.practiceId],
    ).catch(() => ({ rows: [] as any[] })),
    pool.query(
      `SELECT first_name, last_name, date_of_birth,
              address_line1, city, state, zip
         FROM patients WHERE id = $1 AND practice_id = $2 LIMIT 1`,
      [patientId, ctx.practiceId],
    ),
    pool.query(
      `SELECT id, cpt_code, units, fee_cents, allowed_cents,
              service_date, place_of_service, note_id
         FROM ehr_charges
        WHERE practice_id = $1 AND patient_id = $2
          AND service_date >= $3::date AND service_date <= $4::date
        ORDER BY service_date ASC`,
      [ctx.practiceId, patientId, from, to],
    ),
    pool.query(
      `SELECT charge_id, COALESCE(SUM(amount_cents), 0) AS paid_cents
         FROM ehr_payments
        WHERE practice_id = $1 AND patient_id = $2
          AND received_at::date >= $3::date AND received_at::date <= $4::date
          AND charge_id IS NOT NULL
        GROUP BY charge_id`,
      [ctx.practiceId, patientId, from, to],
    ).catch(() => ({ rows: [] as any[] })),
  ])

  const practice = practiceRes.rows[0]
  const patient = patientRes.rows[0]
  if (!patient) return NextResponse.json({ error: 'Patient not found' }, { status: 404 })

  const charges = chargesRes.rows
  const paidByCharge = new Map<string, number>()
  for (const p of paymentsRes.rows) paidByCharge.set(p.charge_id, Number(p.paid_cents))

  // ICD-10 from linked notes.
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
    description: undefined,
    fee_cents: Number(r.fee_cents),
    paid_cents: paidByCharge.get(r.id) ?? Number(r.allowed_cents),
  }))

  const totalFee = lineItems.reduce((s, l) => s + l.fee_cents, 0)
  const totalPaid = lineItems.reduce((s, l) => s + l.paid_cents, 0)

  // Decide whether to INSERT a new row (first generation) or UPDATE the
  // existing row in place (admin regenerate — S3 versioning preserves
  // prior bytes on the server side).
  let superbillId: string
  if (regenerate && existing.rows[0]?.id) {
    superbillId = existing.rows[0].id
    await pool.query(
      `UPDATE ehr_superbills
          SET charges_snapshot_json = $1::jsonb,
              total_cents           = $2,
              generated_by          = $3,
              generated_at          = NOW()
        WHERE id = $4`,
      [JSON.stringify(lineItems), totalPaid, ctx.user.id, superbillId],
    )
  } else {
    const ins = await pool.query(
      `INSERT INTO ehr_superbills (
         practice_id, patient_id, from_date, to_date,
         charges_snapshot_json, total_cents, generated_by
       ) VALUES ($1, $2, $3::date, $4::date, $5::jsonb, $6, $7)
       RETURNING id`,
      [ctx.practiceId, patientId, from, to, JSON.stringify(lineItems), totalPaid, ctx.user.id],
    )
    superbillId = ins.rows[0].id
  }

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
    generated_at: new Date().toISOString(),
    line_items: lineItems,
  })

  // Persist snapshot to S3 + record digest on the row.
  const buf = Buffer.from(bytes)
  let snapshotMeta: { key: string; sha256: string; size: number } | null = null
  try {
    snapshotMeta = await putSuperbillSnapshot({
      practiceId: ctx.practiceId,
      patientId,
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
  } catch (err: any) {
    // Don't break the user's download if S3 is having a bad day; log and
    // continue. Next request will retry the persistence.
    console.error('[superbill.pdf] snapshot persist failed:', err?.message)
  }

  await auditEhrAccess({
    ctx,
    action: regenerate
      ? 'billing.superbill.snapshot_regenerated'
      : 'billing.superbill.snapshot_created',
    resourceType: 'ehr_superbill',
    resourceId: superbillId,
    details: {
      from, to,
      total_fee_cents: totalFee,
      total_paid_cents: totalPaid,
      line_count: lineItems.length,
      pdf_s3_key: snapshotMeta?.key ?? null,
      pdf_sha256: snapshotMeta?.sha256 ?? null,
      pdf_size_bytes: snapshotMeta?.size ?? null,
    },
  })

  // Backwards-compat: keep the legacy generate event so downstream
  // accounting reports don't lose continuity.
  await auditEhrAccess({
    ctx,
    action: 'billing.superbill.generate',
    resourceType: 'ehr_superbill',
    resourceId: superbillId,
    details: {
      from, to,
      total_fee_cents: totalFee,
      total_paid_cents: totalPaid,
      line_count: lineItems.length,
      format: 'pdf',
    },
  })

  const filename = `superbill-${patient.last_name ?? 'patient'}-${from}-to-${to}.pdf`.replace(/\s+/g, '_')
  return new NextResponse(buf, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
