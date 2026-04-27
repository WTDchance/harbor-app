// lib/ehr/preauth-packet.ts
//
// Wave 43 — generate a pre-authorization REQUEST packet PDF that the
// therapist sends to the payer (fax / portal upload / email attachment /
// snail mail). Mirrors the W38 superbill renderer (lib/ehr/superbill.ts):
// pure pdf-lib, in-memory bytes, no persistence.
//
// The route handler (app/api/ehr/patients/[id]/preauth-requests/[reqId]/
// submit/route.ts) is responsible for pulling rows from practices,
// patients, therapists, and ehr_preauth_requests; this module just renders.

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'

export type PreauthPracticeInfo = {
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

export type PreauthProviderInfo = {
  name: string | null
  npi?: string | null
  license_number?: string | null
  license_type?: string | null
  license_state?: string | null
}

export type PreauthPatientInfo = {
  first_name: string | null
  last_name: string | null
  dob: string | null
  member_id: string
  group_id?: string | null
  policy_holder_name?: string | null   // null/undefined => same as patient
  payer_name: string
}

export type PreauthCptLine = {
  code: string
  description?: string | null
}

export type PreauthDxLine = {
  code: string
  description?: string | null
}

export type PreauthRequestData = {
  practice: PreauthPracticeInfo
  provider: PreauthProviderInfo
  patient: PreauthPatientInfo
  diagnoses: PreauthDxLine[]
  cpts: PreauthCptLine[]
  requested_session_count: number
  requested_start_date: string  // ISO date
  requested_end_date: string | null
  frequency_label?: string | null   // e.g. "Weekly, 60-min individual sessions"
  clinical_justification: string
  generated_at: string             // ISO timestamp
  request_id: string               // ehr_preauth_requests.id (printed for ref)
}

// ---- helpers --------------------------------------------------------------

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit' })
}

function joinNonEmpty(parts: Array<string | null | undefined>, sep = ', '): string {
  return parts.filter(Boolean).join(sep)
}

// ---- main render ----------------------------------------------------------

export async function renderPreauthPacketPdf(input: PreauthRequestData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.setTitle(`Pre-Authorization Request - ${input.patient.last_name ?? ''} ${input.patient.first_name ?? ''}`.trim())
  pdf.setSubject('Insurance pre-authorization request packet')
  pdf.setProducer('Harbor EHR')
  pdf.setCreator('Harbor EHR')

  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const fontMono = await pdf.embedFont(StandardFonts.Courier)

  let page: PDFPage = pdf.addPage([612, 792]) // US Letter
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
  // Wrap text into N-character-wide lines using the font's pixel measurements.
  function wrapLines(text: string, maxWidth: number, size = 10, f: PDFFont = font): string[] {
    const words = text.split(/\s+/).filter(Boolean)
    const out: string[] = []
    let line = ''
    for (const w of words) {
      const candidate = line ? `${line} ${w}` : w
      if (f.widthOfTextAtSize(candidate, size) <= maxWidth) {
        line = candidate
      } else {
        if (line) out.push(line)
        // Hard-break a single word longer than the line.
        if (f.widthOfTextAtSize(w, size) > maxWidth) {
          let chunk = ''
          for (const ch of w) {
            const cand2 = chunk + ch
            if (f.widthOfTextAtSize(cand2, size) <= maxWidth) chunk = cand2
            else { out.push(chunk); chunk = ch }
          }
          line = chunk
        } else {
          line = w
        }
      }
    }
    if (line) out.push(line)
    return out
  }

  // ---- Header ------------------------------------------------------------
  drawText('PRE-AUTHORIZATION REQUEST', margin, y, { f: fontBold, size: 18 })
  drawText('Behavioral health services', margin, y - 16, { f: font, size: 10, color: muted })
  const genLabel = `Generated ${fmtDate(input.generated_at)}`
  drawText(genLabel, 612 - margin - fontBold.widthOfTextAtSize(genLabel, 10), y, { f: fontBold, size: 10, color: muted })
  const refLabel = `Request ID: ${input.request_id}`
  drawText(refLabel, 612 - margin - font.widthOfTextAtSize(refLabel, 9), y - 16, { f: fontMono, size: 9, color: muted })
  y -= 36

  // ---- Practice block ----------------------------------------------------
  drawText(input.practice.name, margin, y, { f: fontBold, size: 12 })
  y -= 14
  const practiceLines = [
    joinNonEmpty([input.practice.address_line1, input.practice.address_line2]),
    joinNonEmpty([input.practice.city, input.practice.state, input.practice.zip]),
    joinNonEmpty([input.practice.phone, input.practice.email], '  ·  '),
    joinNonEmpty(
      [
        input.practice.npi ? `Practice NPI: ${input.practice.npi}` : null,
        input.practice.tax_id ? `Tax ID: ${input.practice.tax_id}` : null,
      ],
      '  ·  ',
    ),
  ].filter((l) => l && l.length)
  for (const line of practiceLines) {
    drawText(line, margin, y, { f: font, size: 10 })
    y -= 12
  }

  // Provider sub-block
  if (input.provider.name) {
    drawText(`Rendering provider: ${input.provider.name}`, margin, y, { f: fontBold, size: 10 })
    y -= 12
    const provBits = [
      input.provider.npi ? `Provider NPI: ${input.provider.npi}` : null,
      input.provider.license_number
        ? `License: ${[input.provider.license_type, input.provider.license_number, input.provider.license_state].filter(Boolean).join(' ')}`
        : null,
    ].filter(Boolean) as string[]
    if (provBits.length) {
      drawText(provBits.join('  ·  '), margin, y, { f: font, size: 10, color: muted })
      y -= 12
    }
  }
  y -= 4
  drawRule(y)
  y -= 16

  // ---- Patient + payer block --------------------------------------------
  drawText('Patient', margin, y, { f: fontBold, size: 10, color: muted })
  drawText('Insurance', 320, y, { f: fontBold, size: 10, color: muted })
  y -= 13
  const ptName = `${input.patient.first_name ?? ''} ${input.patient.last_name ?? ''}`.trim() || '—'
  drawText(ptName, margin, y, { f: fontBold, size: 11 })
  drawText(input.patient.payer_name, 320, y, { f: fontBold, size: 11 })
  y -= 13
  if (input.patient.dob) {
    drawText(`DOB: ${fmtDate(input.patient.dob)}`, margin, y, { f: font, size: 10, color: muted })
  }
  drawText(`Member ID: ${input.patient.member_id}`, 320, y, { f: font, size: 10, color: muted })
  y -= 12
  if (input.patient.group_id) {
    drawText(`Group #: ${input.patient.group_id}`, 320, y, { f: font, size: 10, color: muted })
    y -= 12
  }
  if (input.patient.policy_holder_name && input.patient.policy_holder_name.trim() && input.patient.policy_holder_name !== ptName) {
    drawText(`Policy holder: ${input.patient.policy_holder_name}`, 320, y, { f: font, size: 10, color: muted })
    y -= 12
  }
  y -= 4
  drawRule(y)
  y -= 16

  // ---- Clinical block: diagnoses ----------------------------------------
  drawText('Presenting diagnoses (ICD-10)', margin, y, { f: fontBold, size: 10, color: muted })
  y -= 14
  if (input.diagnoses.length === 0) {
    drawText('—', margin, y, { f: font, size: 10, color: muted })
    y -= 12
  } else {
    for (const dx of input.diagnoses) {
      ensureSpace(14)
      drawText(dx.code, margin, y, { f: fontMono, size: 10 })
      if (dx.description) {
        drawText(dx.description, margin + 80, y, { f: font, size: 10 })
      }
      y -= 13
    }
  }
  y -= 6

  // ---- Clinical block: proposed services --------------------------------
  drawText('Proposed services (CPT)', margin, y, { f: fontBold, size: 10, color: muted })
  y -= 14
  if (input.cpts.length === 0) {
    drawText('—', margin, y, { f: font, size: 10, color: muted })
    y -= 12
  } else {
    for (const cpt of input.cpts) {
      ensureSpace(14)
      drawText(cpt.code, margin, y, { f: fontMono, size: 10 })
      if (cpt.description) {
        drawText(cpt.description, margin + 80, y, { f: font, size: 10 })
      }
      y -= 13
    }
  }
  y -= 4

  // Sessions / dates / frequency
  ensureSpace(48)
  drawText('Requested sessions', margin, y, { f: fontBold, size: 10, color: muted })
  drawText('Date span', margin + 200, y, { f: fontBold, size: 10, color: muted })
  drawText('Frequency', margin + 360, y, { f: fontBold, size: 10, color: muted })
  y -= 13
  drawText(String(input.requested_session_count), margin, y, { f: fontBold, size: 11 })
  const span = input.requested_end_date
    ? `${fmtDate(input.requested_start_date)} – ${fmtDate(input.requested_end_date)}`
    : `${fmtDate(input.requested_start_date)} – open-ended`
  drawText(span, margin + 200, y, { f: font, size: 10 })
  drawText(input.frequency_label || 'As clinically indicated', margin + 360, y, { f: font, size: 10 })
  y -= 18
  drawRule(y)
  y -= 16

  // ---- Justification block ----------------------------------------------
  drawText('Clinical justification', margin, y, { f: fontBold, size: 10, color: muted })
  y -= 14
  const justLines = wrapLines(input.clinical_justification || '—', 612 - 2 * margin, 10, font)
  for (const line of justLines) {
    ensureSpace(14)
    drawText(line, margin, y, { f: font, size: 10 })
    y -= 13
  }
  y -= 8
  drawRule(y)
  y -= 18

  // ---- Provider attestation + signature ---------------------------------
  ensureSpace(110)
  drawText('Provider attestation', margin, y, { f: fontBold, size: 10, color: muted })
  y -= 14
  const attest = 'I attest that the diagnoses and proposed services described above are medically necessary for the named patient and are consistent with current clinical standards of care. The clinical information provided is accurate to the best of my knowledge. Records supporting this request are available upon payer request, subject to applicable HIPAA / 42 CFR Part 2 protections.'
  for (const line of wrapLines(attest, 612 - 2 * margin, 10, font)) {
    ensureSpace(14)
    drawText(line, margin, y, { f: font, size: 10 })
    y -= 13
  }
  y -= 14

  // Signature line
  ensureSpace(46)
  drawText('Provider signature', margin, y, { f: fontBold, size: 10, color: muted })
  drawText('Date', margin + 360, y, { f: fontBold, size: 10, color: muted })
  y -= 26
  page.drawLine({ start: { x: margin, y }, end: { x: margin + 320, y }, thickness: 0.6, color: ink })
  page.drawLine({ start: { x: margin + 360, y }, end: { x: 612 - margin, y }, thickness: 0.6, color: ink })
  y -= 12
  if (input.provider.name) {
    drawText(input.provider.name, margin, y, { f: font, size: 10, color: muted })
  }
  drawText(fmtDate(input.generated_at), margin + 360, y, { f: font, size: 10, color: muted })
  y -= 16

  return await pdf.save()
}
