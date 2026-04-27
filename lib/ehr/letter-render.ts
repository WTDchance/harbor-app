// lib/ehr/letter-render.ts
//
// Wave 42 / T3 — render a generated letter as PDF using pdf-lib.
// Mirrors lib/ehr/superbill.ts pattern.

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

export interface LetterRenderInput {
  practice: {
    name: string
    address_line1?: string | null
    city?: string | null
    state?: string | null
    zip?: string | null
    phone?: string | null
  }
  patient: {
    first_name: string | null
    last_name: string | null
  }
  letter_kind: 'disability' | 'school_accommodation' | 'court'
  generated_at: string
  body_md_resolved: string
  signed_at?: string | null
  signed_by_name?: string | null
}

const KIND_TITLES: Record<string, string> = {
  disability: 'Letter of Support — Disability',
  school_accommodation: 'Letter of Support — Educational Accommodations',
  court: 'Letter to the Court',
}

export async function renderLetterPdf(input: LetterRenderInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  const helv = await pdf.embedFont(StandardFonts.Helvetica)
  const helvBold = await pdf.embedFont(StandardFonts.HelveticaBold)

  const PAGE_W = 612
  const PAGE_H = 792
  const MARGIN = 60
  const LH = 14

  let page = pdf.addPage([PAGE_W, PAGE_H])
  let y = PAGE_H - MARGIN
  const contentWidth = PAGE_W - 2 * MARGIN

  function nextLine(size = 11) { y -= size + 4 }
  function newPageIfNeeded() {
    if (y < MARGIN + LH * 2) {
      page = pdf.addPage([PAGE_W, PAGE_H])
      y = PAGE_H - MARGIN
    }
  }
  function write(text: string, font = helv, size = 11, color = rgb(0.1, 0.1, 0.1)) {
    newPageIfNeeded()
    page.drawText(text, { x: MARGIN, y, size, font, color })
    nextLine(size)
  }

  // Header (practice block, top-left).
  write(input.practice.name, helvBold, 13)
  if (input.practice.address_line1) write(input.practice.address_line1, helv, 9, rgb(0.4, 0.4, 0.4))
  const cityLine = [input.practice.city, input.practice.state, input.practice.zip].filter(Boolean).join(', ')
  if (cityLine) write(cityLine, helv, 9, rgb(0.4, 0.4, 0.4))
  if (input.practice.phone) write(`Phone: ${input.practice.phone}`, helv, 9, rgb(0.4, 0.4, 0.4))
  y -= 8

  // Date.
  const dateStr = new Date(input.generated_at).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  })
  write(dateStr, helv, 11)
  y -= 8

  // Title.
  write(KIND_TITLES[input.letter_kind] ?? 'Letter of Support', helvBold, 14, rgb(0.05, 0.4, 0.4))
  y -= 8

  // Re: line.
  const fullName = [input.patient.first_name, input.patient.last_name].filter(Boolean).join(' ') || 'Patient'
  write(`Re: ${fullName}`, helvBold, 11)
  y -= 6

  // Body (markdown rendered as plain text — paragraphs separated by
  // blank lines, single newlines kept as soft breaks). pdf-lib doesn't
  // do markdown natively; we strip basic markers and word-wrap.
  const body = input.body_md_resolved
    // Strip basic markdown emphasis markers (best-effort; keep content).
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')

  const paragraphs = body.split(/\n\s*\n/)
  for (const p of paragraphs) {
    const lines = wrap(p.replace(/\n/g, ' '), helv, 11, contentWidth)
    for (const l of lines) write(l, helv, 11)
    y -= 6
  }

  // Signature block.
  newPageIfNeeded()
  y -= 12
  write('Sincerely,', helv, 11)
  y -= 24
  if (input.signed_by_name) {
    write(input.signed_by_name, helvBold, 11)
    if (input.signed_at) {
      const sigDate = new Date(input.signed_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
      write(`Signed ${sigDate}`, helv, 9, rgb(0.4, 0.4, 0.4))
    }
  } else {
    write('______________________________', helv, 11, rgb(0.4, 0.4, 0.4))
    write('(unsigned)', helv, 9, rgb(0.6, 0.4, 0.0))
  }

  return pdf.save()
}

function wrap(text: string, font: any, size: number, maxWidth: number): string[] {
  if (!text) return ['']
  const words = text.split(/\s+/)
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    const tryLine = cur ? `${cur} ${w}` : w
    const width = font.widthOfTextAtSize(tryLine, size)
    if (width <= maxWidth) cur = tryLine
    else { if (cur) lines.push(cur); cur = w }
  }
  if (cur) lines.push(cur)
  return lines.length ? lines : ['']
}

/**
 * Resolve {{placeholder}} merge fields against patient + practice
 * context. Unknown placeholders are left as literal "{{name}}"
 * (deliberate — it surfaces a missed mapping in the rendered PDF
 * rather than silently swallowing).
 */
export function resolveLetterTemplate(
  templateMd: string,
  context: Record<string, string | null | undefined>,
): string {
  return templateMd.replace(/\{\{\s*([a-z_][a-z0-9_]*)\s*\}\}/gi, (_full, key) => {
    const v = context[key]
    return v == null ? `{{${key}}}` : String(v)
  })
}
