// Superbill HTML generator (printable PDF via the browser's Print dialog).
//
// Snapshots the charge list into ehr_superbills so the document is
// reproducible even if charges later change. HTML render lifted VERBATIM
// from legacy — clinicians review these as legal billing records.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
import { centsToDollars } from '@/lib/ehr/billing'

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

  const [practiceRes, patientRes, chargesRes] = await Promise.all([
    pool.query(
      `SELECT name, billing_tax_id, billing_npi, billing_address, phone_number
         FROM practices WHERE id = $1 LIMIT 1`,
      [ctx.practiceId],
    ).catch(() => ({ rows: [] as any[] })),
    pool.query(
      `SELECT first_name, last_name, date_of_birth, phone, email
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
  ])

  const practice = practiceRes.rows[0]
  const patient = patientRes.rows[0]
  if (!patient) return NextResponse.json({ error: 'Patient not found' }, { status: 404 })

  const rows = chargesRes.rows

  // ICD-10 codes from the linked notes.
  const noteIds = rows.map(r => r.note_id).filter(Boolean)
  let icdByNote = new Map<string, string[]>()
  if (noteIds.length > 0) {
    const { rows: notes } = await pool.query(
      `SELECT id, icd10_codes FROM ehr_progress_notes
        WHERE id = ANY($1::uuid[])`,
      [noteIds],
    ).catch(() => ({ rows: [] as any[] }))
    icdByNote = new Map(notes.map((n: any) => [n.id, n.icd10_codes || []]))
  }

  const total = rows.reduce((s, r) => s + Number(r.allowed_cents), 0)

  // Persist snapshot — single insert.
  await pool.query(
    `INSERT INTO ehr_superbills (
       practice_id, patient_id, from_date, to_date,
       charges_snapshot_json, total_cents, generated_by
     ) VALUES ($1, $2, $3::date, $4::date, $5::jsonb, $6, $7)`,
    [ctx.practiceId, patientId, from, to, JSON.stringify(rows), total, ctx.user.id],
  ).catch(err => console.error('[superbill] snapshot insert failed:', err.message))

  await auditEhrAccess({
    ctx,
    action: 'billing.superbill.generate',
    resourceType: 'ehr_superbill',
    resourceId: patientId,
    details: { from, to, total_cents: total, line_count: rows.length },
  })

  const html = render({ practice, patient, rows, icdByNote, from, to, total })
  return new NextResponse(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}

function esc(s: any): string {
  if (s == null) return ''
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!),
  )
}

function render(d: any): string {
  const pr = d.practice ?? {}
  const pt = d.patient ?? {}
  const name = [pt.first_name, pt.last_name].filter(Boolean).join(' ')
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Superbill — ${esc(name)}</title>
<style>
  @page { margin: 0.5in; }
  body { font-family: Georgia, 'Times New Roman', serif; color: #111; line-height: 1.4; max-width: 760px; margin: 1rem auto; padding: 0 1rem; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #111; padding-bottom: 0.5rem; margin-bottom: 1rem; }
  .practice-name { font-size: 1.2rem; font-weight: bold; }
  .meta { font-size: 0.85rem; color: #555; }
  h1 { font-size: 1.4rem; margin: 1rem 0 0.5rem; }
  h2 { font-size: 1rem; margin-top: 1.25rem; border-bottom: 1px solid #bbb; padding-bottom: 0.1rem; }
  .kv { display: grid; grid-template-columns: 160px 1fr; gap: 0.2rem 0.8rem; font-size: 0.9rem; }
  .kv > div:nth-child(odd) { color: #555; }
  table { width: 100%; border-collapse: collapse; font-size: 0.88rem; margin-top: 0.5rem; }
  th, td { text-align: left; padding: 6px 4px; border-bottom: 1px solid #ddd; }
  th { background: #f5f5f5; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.03em; color: #555; }
  td.r, th.r { text-align: right; }
  tr.total td { border-top: 2px solid #111; border-bottom: none; font-weight: bold; padding-top: 10px; }
  .signature { margin-top: 2rem; padding-top: 1rem; border-top: 1px solid #999; }
  .footer { margin-top: 2rem; font-size: 0.75rem; color: #666; border-top: 1px solid #e5e7eb; padding-top: 0.5rem; }
  @media print { body { margin: 0 auto; } }
</style></head><body>
<div class="header">
  <div>
    <div class="practice-name">${esc(pr.name ?? 'Therapy Practice')}</div>
    <div class="meta">${esc(pr.billing_address ?? '')}</div>
    <div class="meta">${esc(pr.phone_number ?? '')}</div>
  </div>
  <div class="meta" style="text-align: right;">
    ${pr.billing_npi ? `NPI: ${esc(pr.billing_npi)}<br>` : ''}
    ${pr.billing_tax_id ? `Tax ID: ${esc(pr.billing_tax_id)}` : ''}
  </div>
</div>
<h1>Superbill</h1>
<div class="meta">For insurance reimbursement submission by the patient. Services: ${esc(d.from)} to ${esc(d.to)}.</div>

<h2>Patient</h2>
<div class="kv">
  <div>Name</div><div>${esc(name)}</div>
  <div>Date of birth</div><div>${esc(pt.date_of_birth ?? '')}</div>
  <div>Phone</div><div>${esc(pt.phone ?? '')}</div>
  <div>Email</div><div>${esc(pt.email ?? '')}</div>
</div>

<h2>Services rendered</h2>
<table>
  <thead>
    <tr>
      <th>Date</th>
      <th>CPT</th>
      <th>POS</th>
      <th>Diagnoses (ICD-10)</th>
      <th class="r">Units</th>
      <th class="r">Fee</th>
    </tr>
  </thead>
  <tbody>
    ${d.rows.map((r: any) => {
      const icds = (d.icdByNote.get(r.note_id) || []).join(', ')
      return `
        <tr>
          <td>${esc(r.service_date)}</td>
          <td>${esc(r.cpt_code)}</td>
          <td>${esc(r.place_of_service ?? '')}</td>
          <td>${esc(icds)}</td>
          <td class="r">${esc(r.units)}</td>
          <td class="r">${esc(centsToDollars(r.allowed_cents))}</td>
        </tr>
      `
    }).join('')}
    <tr class="total">
      <td colspan="5">Total amount paid by patient</td>
      <td class="r">${esc(centsToDollars(d.total))}</td>
    </tr>
  </tbody>
</table>

<div class="signature">
  <div class="meta">Clinician signature:</div>
  <div style="height: 44px; border-bottom: 1px solid #333; width: 360px; margin-top: 8px;"></div>
  <div class="meta" style="margin-top: 4px;">Date: ____________________</div>
</div>

<div class="footer">
  This document is provided to the patient for submission to their insurance carrier. The practice is not responsible for
  reimbursement outcome. Services listed above were rendered by a licensed clinician and are supported by clinical
  documentation on file. Protected health information — handle under HIPAA.
</div>
</body></html>`
}
