// app/api/ehr/billing/superbill/pdf/route.ts
//
// Wave 38 / TS7 — therapist-side PDF superbill via pdf-lib.
//
// Same data as the HTML version (sibling route ../route.ts), but rendered
// as a downloadable PDF. Snapshots into ehr_superbills so the document is
// reproducible after the fact.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
import { renderSuperbillPdf, type SuperbillLineItem } from '@/lib/ehr/superbill'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const sp = req.nextUrl.searchParams
  const patientId = sp.get('patient_id')
  const from = sp.get('from')
  const to = sp.get('to')
  if (!patientId || !from || !to) {
    return NextResponse.json({ error: 'patient_id, from, to required' }, { status: 400 })
  }

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

  // ICD-10 from linked notes
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

  // Snapshot
  await pool.query(
    `INSERT INTO ehr_superbills (
       practice_id, patient_id, from_date, to_date,
       charges_snapshot_json, total_cents, generated_by
     ) VALUES ($1, $2, $3::date, $4::date, $5::jsonb, $6, $7)`,
    [ctx.practiceId, patientId, from, to, JSON.stringify(lineItems), totalPaid, ctx.user.id],
  ).catch((err: any) => console.error('[superbill.pdf] snapshot insert failed:', err.message))

  await auditEhrAccess({
    ctx,
    action: 'billing.superbill.generate',
    resourceType: 'ehr_superbill',
    resourceId: patientId,
    details: {
      from, to,
      total_fee_cents: totalFee,
      total_paid_cents: totalPaid,
      line_count: lineItems.length,
      format: 'pdf',
    },
  })

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

  const filename = `superbill-${patient.last_name ?? 'patient'}-${from}-to-${to}.pdf`.replace(/\s+/g, '_')
  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
