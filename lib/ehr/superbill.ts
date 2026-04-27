// lib/ehr/superbill.ts
//
// Wave 38 / TS7 — generate a self-pay superbill PDF the patient can submit
// to their insurance for out-of-network reimbursement.
//
// Inputs come from /api/ehr/superbill (therapist) or /api/portal/superbill
// (patient portal). The route is responsible for the auth check and for
// pulling the relevant rows from `practices`, `patients`, `ehr_charges`,
// and `ehr_payments`. This module just renders.

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'

export type SuperbillPracticeInfo = {
  name: string
  address_line1?: string | null
  address_line2?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  phone?: string | null
  email?: string | null
  npi?: string | null
  tax_id?: string | null
}

export type SuperbillPatientInfo = {
  first_name: string | null
  last_name: string | null
  dob: string | null         // ISO date
  address_line1?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
}

export type SuperbillLineItem = {
  service_date: string       // ISO date
  cpt_code: string
  modifiers?: string[]
  icd10_codes?: string[]
  description?: string
  fee_cents: number
  paid_cents: number
}

export type SuperbillInput = {
  practice: SuperbillPracticeInfo
  patient: SuperbillPatientInfo
  range_start: string        // ISO date
  range_end: string          // ISO date
  generated_at: string       // ISO timestamp
  line_items: SuperbillLineItem[]
}

// --- helpers ---------------------------------------------------------------

function fmtUsd(cents: number): string {
  const dollars = (cents || 0) / 100
  return dollars.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit' })
}

function joinNonEmpty(parts: Array<string | null | undefined>, sep = ', '): string {
  return parts.filter(Boolean).join(sep)
}

// --- main render ----------------------------------------------------------

export async function renderSuperbillPdf(input: SuperbillInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.setTitle(`Superbill - ${input.patient.last_name ?? ''} ${input.patient.first_name ?? ''}`)
  pdf.setSubject('Self-pay superbill')
  pdf.setProducer('Harbor EHR')
  pdf.setCreator('Harbor EHR')

  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const fontMono = await pdf.embedFont(StandardFonts.Courier)

  let page = pdf.addPage([612, 792]) // US Letter
  const margin = 50
  let y = 792 - margin
  const ink = rgb(0.10, 0.12, 0.14)
  const muted = rgb(0.40, 0.44, 0.48)
  const rule = rgb(0.85, 0.87, 0.90)

  function newPage() {
    page = pdf.addPage([612, 792])
    y = 792 - margin
  }
  function ensureSpace(h: number) {
    if (y - h < margin + 60) newPage()
  }
  function drawText(text: string, x: number, yPos: number, opts: { f?: PDFFont; size?: number; color?: ReturnType<typeof rgb> } = {}) {
    page.drawText(text, {
      x,
      y: yPos,
      size: opts.size ?? 10,
      font: opts.f ?? font,
      color: opts.color ?? ink,
    })
  }
  function drawRule(yPos: number) {
    page.drawLine({
      start: { x: margin, y: yPos },
      end: { x: 612 - margin, y: yPos },
      thickness: 0.5,
      color: rule,
    })
  }

  // Header — practice block
  drawText('SUPERBILL', margin, y, { f: fontBold, size: 18 })
  drawText('For self-pay reimbursement', margin, y - 16, { f: font, size: 10, color: muted })
  // Generated date right-aligned
  const genLabel = `Generated ${fmtDate(input.generated_at)}`
  drawText(genLabel, 612 - margin - fontBold.widthOfTextAtSize(genLabel, 10), y, { f: fontBold, size: 10, color: muted })
  y -= 36

  drawText(input.practice.name, margin, y, { f: fontBold, size: 12 })
  y -= 14
  const practiceLines = [
    joinNonEmpty([input.practice.address_line1, input.practice.address_line2]),
    joinNonEmpty([input.practice.city, input.practice.state, input.practice.zip]),
    joinNonEmpty([input.practice.phone, input.practice.email], '  ·  '),
    joinNonEmpty(
      [
        input.practice.npi ? `NPI: ${input.practice.npi}` : null,
        input.practice.tax_id ? `Tax ID: ${input.practice.tax_id}` : null,
      ],
      '  ·  ',
    ),
  ].filter((l) => l && l.length)
  for (const line of practiceLines) {
    drawText(line, margin, y, { f: font, size: 10 })
    y -= 12
  }
  y -= 4
  drawRule(y)
  y -= 16

  // Patient + range block
  drawText('Patient', margin, y, { f: fontBold, size: 10, color: muted })
  drawText('Service period', 320, y, { f: fontBold, size: 10, color: muted })
  y -= 13
  const ptName = `${input.patient.first_name ?? ''} ${input.patient.last_name ?? ''}`.trim() || '—'
  drawText(ptName, margin, y, { f: fontBold, size: 11 })
  drawText(`${fmtDate(input.range_start)} – ${fmtDate(input.range_end)}`, 320, y, { f: fontBold, size: 11 })
  y -= 13
  if (input.patient.dob) {
    drawText(`DOB: ${fmtDate(input.patient.dob)}`, margin, y, { f: font, size: 10, color: muted })
  }
  y -= 12
  const ptAddr = [
    input.patient.address_line1,
    joinNonEmpty([input.patient.city, input.patient.state, input.patient.zip]),
  ].filter(Boolean) as string[]
  for (const line of ptAddr) {
    drawText(line, margin, y, { f: font, size: 10, color: muted })
    y -= 11
  }
  y -= 4
  drawRule(y)
  y -= 18

  // Line item table header
  const cols = {
    date: margin,
    cpt: margin + 80,
    icd: margin + 170,
    desc: margin + 250,
    fee: 612 - margin - 130,
    paid: 612 - margin - 60,
  }
  drawText('Date',        cols.date, y, { f: fontBold, size: 9, color: muted })
  drawText('CPT',         cols.cpt,  y, { f: fontBold, size: 9, color: muted })
  drawText('Diagnosis',   cols.icd,  y, { f: fontBold, size: 9, color: muted })
  drawText('Description', cols.desc, y, { f: fontBold, size: 9, color: muted })
  drawText('Fee',         cols.fee,  y, { f: fontBold, size: 9, color: muted })
  drawText('Paid',        cols.paid, y, { f: fontBold, size: 9, color: muted })
  y -= 6
  drawRule(y)
  y -= 12

  let totalFee = 0
  let totalPaid = 0

  for (const li of input.line_items) {
    ensureSpace(28)
    totalFee += li.fee_cents
    totalPaid += li.paid_cents
    drawText(fmtDate(li.service_date), cols.date, y, { size: 9 })
    const cptText = (li.cpt_code || '') + (li.modifiers && li.modifiers.length ? ` (${li.modifiers.join(',')})` : '')
    drawText(cptText, cols.cpt, y, { f: fontMono, size: 9 })
    drawText((li.icd10_codes ?? []).join(', ') || '—', cols.icd, y, { f: fontMono, size: 9 })
    const desc = (li.description || '').slice(0, 32)
    drawText(desc, cols.desc, y, { size: 9 })
    const feeStr = fmtUsd(li.fee_cents)
    drawText(feeStr, cols.fee + (60 - font.widthOfTextAtSize(feeStr, 9)), y, { size: 9 })
    const paidStr = fmtUsd(li.paid_cents)
    drawText(paidStr, cols.paid + (50 - font.widthOfTextAtSize(paidStr, 9)), y, { size: 9 })
    y -= 14
  }
  if (input.line_items.length === 0) {
    drawText('No paid sessions in this date range.', margin, y, { size: 10, color: muted })
    y -= 14
  }

  y -= 4
  drawRule(y)
  y -= 14

  // Totals row
  const totalLabel = 'Total fees'
  const paidLabel = 'Total paid'
  drawText(totalLabel, cols.fee - 60 - font.widthOfTextAtSize(totalLabel, 10), y, { f: fontBold, size: 10 })
  const tFee = fmtUsd(totalFee)
  drawText(tFee, cols.fee + (60 - fontBold.widthOfTextAtSize(tFee, 10)), y, { f: fontBold, size: 10 })
  const tPaid = fmtUsd(totalPaid)
  drawText(tPaid, cols.paid + (50 - fontBold.widthOfTextAtSize(tPaid, 10)), y, { f: fontBold, size: 10 })
  y -= 14
  const balanceLabel = 'Balance owed by patient'
  drawText(balanceLabel, cols.fee - 60 - font.widthOfTextAtSize(balanceLabel, 10), y, { size: 10, color: muted })
  const balance = fmtUsd(Math.max(0, totalFee - totalPaid))
  drawText(balance, cols.paid + (50 - font.widthOfTextAtSize(balance, 10)), y, { size: 10, color: muted })
  y -= 24

  // Footer
  ensureSpace(56)
  drawRule(y)
  y -= 14
  const footer = 'Submit to your insurance for reimbursement. This is not a bill from your insurer. Services provided as out-of-network self-pay.'
  drawText(footer, margin, y, { size: 9, color: muted })
  y -= 12
  const footer2 = 'For questions, contact the practice directly using the information above.'
  drawText(footer2, margin, y, { size: 9, color: muted })

  return await pdf.save()
}
