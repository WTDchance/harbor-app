// lib/ehr/hsa-receipt.ts
//
// Wave 43 / T5 — HSA / FSA receipt renderer.
//
// Different from a superbill: where a superbill itemizes the FEE for
// each session (so the patient can submit it to insurance and seek
// reimbursement), an HSA/FSA receipt itemizes what the patient ACTUALLY
// PAID out of pocket so they can submit it to their HSA/FSA plan
// administrator. The receipt is intended as proof of qualified medical
// expense, and the line items are payments — date, method, amount.
//
// Single-page Letter-size PDF. No CPT/ICD detail (HSA admins rarely
// require it; if they do, the patient can attach the superbill too).
// Includes an explicit "PAID IN FULL" stamp at the top and a
// "Qualified medical expense — psychotherapy services" caption.

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

export type HsaReceiptPracticeInfo = {
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

export type HsaReceiptPatientInfo = {
  first_name: string | null
  last_name: string | null
  dob: string | null
}

export type HsaReceiptPaymentLine = {
  paid_at: string         // ISO date / timestamp
  method: string          // 'card' | 'cash' | 'check' | 'hsa_card' | etc.
  amount_cents: number
  reference?: string | null  // last4, check #, stripe payment_intent, etc.
  service_date?: string | null
  description?: string | null
}

export type HsaReceiptInput = {
  practice: HsaReceiptPracticeInfo
  patient: HsaReceiptPatientInfo
  range_start: string     // ISO date
  range_end: string       // ISO date
  generated_at: string    // ISO timestamp
  receipt_number: string  // human-readable id, e.g. HSA-{practiceShort}-{yymmdd}-{rand4}
  payments: HsaReceiptPaymentLine[]
}

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

export async function renderHsaReceiptPdf(input: HsaReceiptInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.setTitle(`HSA-FSA Receipt - ${input.patient.last_name ?? ''} ${input.patient.first_name ?? ''}`)
  pdf.setSubject('HSA/FSA receipt — qualified medical expense')
  pdf.setProducer('Harbor EHR')
  pdf.setCreator('Harbor EHR')

  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold)

  let page = pdf.addPage([612, 792]) // US Letter
  const margin = 50
  let y = 792 - margin
  const ink = rgb(0.10, 0.12, 0.14)
  const muted = rgb(0.40, 0.44, 0.48)
  const rule = rgb(0.85, 0.87, 0.90)
  const accent = rgb(0.31, 0.51, 0.69) // Harbor blue

  function drawText(text: string, x: number, yPos: number, opts: { f?: typeof font; size?: number; color?: ReturnType<typeof rgb> } = {}) {
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

  // Header
  drawText('PAYMENT RECEIPT', margin, y, { f: fontBold, size: 18 })
  drawText('For HSA / FSA reimbursement', margin, y - 16, { size: 10, color: muted })

  const rightLabel = `Receipt #${input.receipt_number}`
  drawText(rightLabel, 612 - margin - fontBold.widthOfTextAtSize(rightLabel, 10), y, { f: fontBold, size: 10 })
  const dateLabel = `Issued ${fmtDate(input.generated_at)}`
  drawText(dateLabel, 612 - margin - font.widthOfTextAtSize(dateLabel, 10), y - 14, { size: 10, color: muted })
  y -= 36

  // Practice
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
    drawText(line, margin, y, { size: 10 })
    y -= 12
  }
  y -= 4
  drawRule(y)
  y -= 16

  // Patient + service period
  drawText('Paid by', margin, y, { f: fontBold, size: 10, color: muted })
  drawText('Service period', 320, y, { f: fontBold, size: 10, color: muted })
  y -= 13
  const ptName = `${input.patient.first_name ?? ''} ${input.patient.last_name ?? ''}`.trim() || '—'
  drawText(ptName, margin, y, { f: fontBold, size: 11 })
  drawText(`${fmtDate(input.range_start)} – ${fmtDate(input.range_end)}`, 320, y, { f: fontBold, size: 11 })
  y -= 13
  if (input.patient.dob) {
    drawText(`DOB: ${fmtDate(input.patient.dob)}`, margin, y, { size: 10, color: muted })
    y -= 12
  }
  y -= 4
  drawRule(y)
  y -= 16

  // Service description
  drawText('Service description', margin, y, { f: fontBold, size: 10, color: muted })
  y -= 13
  drawText(
    'Qualified medical expense — outpatient psychotherapy services',
    margin, y, { size: 11 },
  )
  y -= 14
  drawText(
    'IRS Publication 502 lists psychotherapy as a qualified medical expense.',
    margin, y, { size: 9, color: muted },
  )
  y -= 18
  drawRule(y)
  y -= 16

  // Payments table
  drawText('Date',        margin,       y, { f: fontBold, size: 10, color: muted })
  drawText('Method',      margin + 95,  y, { f: fontBold, size: 10, color: muted })
  drawText('Reference',   margin + 200, y, { f: fontBold, size: 10, color: muted })
  drawText('Amount',      612 - margin - 60, y, { f: fontBold, size: 10, color: muted })
  y -= 12
  drawRule(y)
  y -= 14

  let totalCents = 0
  for (const p of input.payments) {
    drawText(fmtDate(p.paid_at),                  margin,       y, { size: 10 })
    drawText((p.method || '').replace(/_/g, ' '), margin + 95,  y, { size: 10 })
    drawText((p.reference || '').slice(0, 28),    margin + 200, y, { size: 10, color: muted })
    const amount = fmtUsd(p.amount_cents)
    drawText(amount, 612 - margin - font.widthOfTextAtSize(amount, 10), y, { size: 10 })
    totalCents += p.amount_cents
    y -= 13
    if (y < margin + 120) {
      page = pdf.addPage([612, 792])
      y = 792 - margin
    }
  }

  // Total
  y -= 6
  drawRule(y)
  y -= 16
  drawText('Total paid', margin + 200, y, { f: fontBold, size: 12 })
  const totalStr = fmtUsd(totalCents)
  drawText(totalStr, 612 - margin - fontBold.widthOfTextAtSize(totalStr, 12), y, { f: fontBold, size: 12, color: accent })

  // Footer disclosure
  y -= 40
  drawText(
    'This receipt confirms payment for services rendered. Retain for your',
    margin, y, { size: 9, color: muted },
  )
  y -= 11
  drawText(
    'HSA or FSA records. Consult your plan administrator with eligibility questions.',
    margin, y, { size: 9, color: muted },
  )

  return pdf.save()
}

/** Helper that callers can use to build a receipt number. Stable
 *  format makes them sortable + greppable in audit logs. */
export function buildReceiptNumber(practiceId: string, generatedAt: Date): string {
  const yy = String(generatedAt.getUTCFullYear()).slice(-2)
  const mm = String(generatedAt.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(generatedAt.getUTCDate()).padStart(2, '0')
  const short = practiceId.replace(/-/g, '').slice(0, 6).toUpperCase()
  const rand = Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0').toUpperCase()
  return `HSA-${short}-${yy}${mm}${dd}-${rand}`
}
