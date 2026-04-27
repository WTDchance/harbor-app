// app/api/portal/superbills/[id]/route.ts
//
// Wave 40 / P5 — patient-portal per-id superbill PDF download.
//
// Auth: requirePortalSession — the PATIENT themselves. Never a
// clinician masquerading. The query also constrains to
// sess.patientId so a session for one patient cannot read another's
// superbill even by guessing IDs.
//
// Resolves the saved superbill row's from_date / to_date and
// regenerates the PDF using the same renderer the therapist side
// uses. (The ehr_superbills.charges_snapshot_json could be used to
// pin the PDF to what was issued at generation time, but the
// existing portal PDF route at /api/portal/superbill/pdf re-queries
// live charges — we mirror that shape here for consistency. Pinning
// to the snapshot is a separate hardening pass.)

import { NextResponse, type NextRequest } from 'next/server'
import { requirePortalSession } from '@/lib/aws/portal-auth'
import { pool } from '@/lib/aws/db'
import { auditPortalAccess } from '@/lib/aws/ehr/audit'
import { renderSuperbillPdf, type SuperbillLineItem } from '@/lib/ehr/superbill'

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
    `SELECT id, from_date, to_date, total_cents, generated_at
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

  await auditPortalAccess({
    session: sess,
    action: 'portal.superbill.download',
    resourceType: 'ehr_superbill',
    resourceId: superbillId,
    details: { from, to, line_count: lineItems.length, format: 'pdf' },
  }).catch(() => {})

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

  const filename = `superbill-${patient.last_name ?? 'self'}-${from}-to-${to}.pdf`.replace(/\s+/g, '_')
  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
