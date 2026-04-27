// app/api/ehr/patients/[id]/disclosures/accounting/route.ts
//
// Wave 41 / T1 — generate the patient-facing Accounting of
// Disclosures PDF per §164.528. Only includes rows with
// included_in_accounting = TRUE (per the regulation's exclusions).
//
// GET ?from=YYYY-MM-DD&to=YYYY-MM-DD   (default: last 6 years)

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
import { renderAccountingPdf, type AccountingRow } from '@/lib/ehr/disclosure-accounting'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id: patientId } = await params

  const sp = req.nextUrl.searchParams
  const sixYearsAgo = new Date(Date.now() - 6 * 365 * 24 * 60 * 60 * 1000)
  const from = sp.get('from') || sixYearsAgo.toISOString().slice(0, 10)
  const to = sp.get('to') || new Date().toISOString().slice(0, 10)

  const [practiceRes, patientRes, rowsRes] = await Promise.all([
    pool.query(
      `SELECT name, address_line1, city, state, zip, phone_number, email
         FROM practices WHERE id = $1 LIMIT 1`,
      [ctx.practiceId],
    ).catch(() => ({ rows: [] as any[] })),
    pool.query(
      `SELECT first_name, last_name, date_of_birth
         FROM patients WHERE id = $1 AND practice_id = $2 LIMIT 1`,
      [patientId, ctx.practiceId],
    ),
    pool.query(
      `SELECT disclosed_at, disclosure_kind, recipient_name,
              recipient_address, purpose, description_of_phi,
              is_part2_protected
         FROM ehr_disclosure_records
        WHERE practice_id = $1 AND patient_id = $2
          AND included_in_accounting = TRUE
          AND disclosed_at::date >= $3::date
          AND disclosed_at::date <= $4::date
        ORDER BY disclosed_at DESC`,
      [ctx.practiceId, patientId, from, to],
    ),
  ])

  const practice = practiceRes.rows[0]
  const patient = patientRes.rows[0]
  if (!patient) return NextResponse.json({ error: 'Patient not found' }, { status: 404 })

  const rows: AccountingRow[] = rowsRes.rows.map((r: any) => ({
    disclosed_at: r.disclosed_at,
    disclosure_kind: r.disclosure_kind,
    recipient_name: r.recipient_name,
    recipient_address: r.recipient_address ?? null,
    purpose: r.purpose,
    description_of_phi: r.description_of_phi,
    is_part2_protected: !!r.is_part2_protected,
  }))

  const bytes = await renderAccountingPdf({
    practice: {
      name: practice?.name ?? 'Therapy Practice',
      address_line1: practice?.address_line1 ?? null,
      city: practice?.city ?? null,
      state: practice?.state ?? null,
      zip: practice?.zip ?? null,
      phone: practice?.phone_number ?? null,
      email: practice?.email ?? null,
    },
    patient: {
      first_name: patient.first_name ?? null,
      last_name: patient.last_name ?? null,
      dob: patient.date_of_birth ?? null,
      patient_id: patientId,
    },
    range_start: from,
    range_end: to,
    generated_at: new Date().toISOString(),
    rows,
  })

  await auditEhrAccess({
    ctx,
    action: 'disclosure.accounting_generated',
    resourceType: 'ehr_disclosure_accounting',
    resourceId: patientId,
    details: { from, to, row_count: rows.length, format: 'pdf' },
  })

  const filename = `accounting-of-disclosures-${patient.last_name ?? patientId}-${from}-to-${to}.pdf`.replace(/\s+/g, '_')
  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
