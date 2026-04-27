// lib/ehr/disclosure-accounting.ts
//
// Wave 41 / T1 — render an Accounting of Disclosures PDF per
// HIPAA §164.528. Mirrors the lib/ehr/superbill renderSuperbillPdf
// pattern (pdf-lib, no external network calls).

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'

export interface AccountingPracticeInfo {
  name: string
  address_line1?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  phone?: string | null
  email?: string | null
}

export interface AccountingPatientInfo {
  first_name: string | null
  last_name: string | null
  dob?: string | null
  patient_id: string
}

export interface AccountingRow {
  disclosed_at: string  // ISO
  disclosure_kind: string
  recipient_name: string
  recipient_address: string | null
  purpose: string
  description_of_phi: string
  is_part2_protected: boolean
}

export interface AccountingInput {
  practice: AccountingPracticeInfo
  patient: AccountingPatientInfo
  range_start: string  // YYYY-MM-DD
  range_end: string
  generated_at: string
  rows: AccountingRow[]
}

const MARGIN = 48
const LINE_HEIGHT = 14
const SMALL = 9
const BODY = 11
const HEADER = 16

function drawText(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  font: PDFFont,
  size: number = BODY,
  color = rgb(0.1, 0.1, 0.1),
) {
  page.drawText(text, { x, y, size, font, color })
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  if (!text) return ['']
  const words = text.split(/\s+/)
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    const tryLine = cur ? `${cur} ${w}` : w
    const width = font.widthOfTextAtSize(tryLine, size)
    if (width <= maxWidth) {
      cur = tryLine
    } else {
      if (cur) lines.push(cur)
      cur = w
    }
  }
  if (cur) lines.push(cur)
  return lines.length ? lines : ['']
}

export async function renderAccountingPdf(input: AccountingInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  const helv = await pdf.embedFont(StandardFonts.Helvetica)
  const helvBold = await pdf.embedFont(StandardFonts.HelveticaBold)

  let page = pdf.addPage([612, 792]) // US Letter
  const W = page.getWidth()
  const H = page.getHeight()
  const contentWidth = W - 2 * MARGIN
  let y = H - MARGIN

  const writeLine = (txt: string, font: PDFFont = helv, size: number = BODY, color = rgb(0.1, 0.1, 0.1)) => {
    if (y < MARGIN + LINE_HEIGHT * 2) {
      page = pdf.addPage([612, 792])
      y = H - MARGIN
    }
    drawText(page, txt, MARGIN, y, font, size, color)
    y -= size + 4
  }

  // Header.
  writeLine('Accounting of Disclosures', helvBold, HEADER, rgb(0.05, 0.4, 0.4))
  writeLine('Per 45 CFR §164.528 (HIPAA Privacy Rule)', helv, SMALL, rgb(0.4, 0.4, 0.4))
  y -= 6

  // Practice block.
  writeLine(input.practice.name, helvBold, BODY)
  if (input.practice.address_line1) writeLine(input.practice.address_line1, helv, SMALL)
  const cityLine = [input.practice.city, input.practice.state, input.practice.zip].filter(Boolean).join(', ')
  if (cityLine) writeLine(cityLine, helv, SMALL)
  if (input.practice.phone) writeLine(`Phone: ${input.practice.phone}`, helv, SMALL)
  if (input.practice.email) writeLine(input.practice.email, helv, SMALL)
  y -= 8

  // Patient block.
  const fullName = [input.patient.first_name, input.patient.last_name].filter(Boolean).join(' ') || '—'
  writeLine(`Patient: ${fullName}`, helvBold, BODY)
  if (input.patient.dob) writeLine(`DOB: ${input.patient.dob}`, helv, SMALL)
  writeLine(`Patient ID: ${input.patient.patient_id}`, helv, SMALL, rgb(0.4, 0.4, 0.4))
  y -= 4
  writeLine(
    `Reporting period: ${input.range_start} through ${input.range_end}`,
    helv,
    BODY,
  )
  writeLine(`Generated: ${new Date(input.generated_at).toLocaleString()}`, helv, SMALL, rgb(0.4, 0.4, 0.4))
  y -= 12

  // Body.
  if (input.rows.length === 0) {
    writeLine('No accounting-eligible disclosures during this period.', helv, BODY, rgb(0.3, 0.3, 0.3))
    y -= 8
    writeLine(
      'Note: §164.528(a)(1) excludes disclosures for treatment, payment, '
        + 'healthcare operations, and disclosures pursuant to authorization.',
      helv,
      SMALL,
      rgb(0.4, 0.4, 0.4),
    )
  } else {
    writeLine(`Disclosures (${input.rows.length}):`, helvBold, BODY)
    y -= 4
    for (const r of input.rows) {
      // Header line: date + kind
      const dateStr = new Date(r.disclosed_at).toLocaleDateString()
      writeLine(`${dateStr} — ${r.disclosure_kind}`, helvBold, BODY, rgb(0.05, 0.3, 0.3))
      writeLine(`Recipient: ${r.recipient_name}`, helv, SMALL)
      if (r.recipient_address) writeLine(`Address: ${r.recipient_address}`, helv, SMALL)
      // Wrapped purpose + description
      for (const line of wrapText(`Purpose: ${r.purpose}`, helv, SMALL, contentWidth)) {
        writeLine(line, helv, SMALL)
      }
      for (const line of wrapText(`PHI disclosed: ${r.description_of_phi}`, helv, SMALL, contentWidth)) {
        writeLine(line, helv, SMALL)
      }
      if (r.is_part2_protected) {
        writeLine(
          '⚠ 42 CFR Part 2 protected — re-disclosure prohibited',
          helvBold,
          SMALL,
          rgb(0.7, 0.1, 0.1),
        )
      }
      y -= 6
    }
  }

  // Footer disclaimer at bottom of last page (best-effort: if no
  // room, a new page).
  if (y < MARGIN + LINE_HEIGHT * 6) {
    page = pdf.addPage([612, 792])
    y = H - MARGIN
  }
  y -= 8
  writeLine(
    'You have the right to receive this accounting of certain disclosures of your protected',
    helv, SMALL, rgb(0.3, 0.3, 0.3),
  )
  writeLine(
    'health information for the past six years. This accounting excludes disclosures for',
    helv, SMALL, rgb(0.3, 0.3, 0.3),
  )
  writeLine(
    'treatment, payment, or healthcare operations, and disclosures you authorized.',
    helv, SMALL, rgb(0.3, 0.3, 0.3),
  )

  return pdf.save()
}
