// app/api/webhooks/stedi-835/route.ts
//
// W52 D4 — Stedi 835 webhook handler. Persists the remittance + per-line
// payments and auto-matches each line to an existing invoice/appointment
// when possible.
//
// Auth: Stedi signs each webhook with HMAC-SHA256 over the raw body
// using STEDI_WEBHOOK_SECRET. Header is x-stedi-signature.

import { NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { pool } from '@/lib/aws/db'
import { writeAuditLog } from '@/lib/audit'
import { autoMatchEraLine } from '@/lib/ehr/era-match'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function verifySignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.STEDI_WEBHOOK_SECRET || ''
  if (!secret) return process.env.STEDI_WEBHOOK_DEV_BYPASS === '1'
  if (!signature) return false
  const computed = createHmac('sha256', secret).update(rawBody).digest('hex')
  try {
    const a = Buffer.from(computed, 'hex')
    const b = Buffer.from(signature.replace(/^sha256=/, ''), 'hex')
    return a.length === b.length && timingSafeEqual(a, b)
  } catch { return false }
}

interface ParsedLine {
  patient_account_number?: string | null
  service_date?: string | null
  cpt_code?: string | null
  billed_amount_cents?: number | null
  allowed_amount_cents?: number | null
  paid_amount_cents?: number | null
  patient_responsibility_cents?: number | null
  adjustment_codes?: any[]
}

export async function POST(req: NextRequest) {
  const raw = await req.text()
  const sig = req.headers.get('x-stedi-signature')
  if (!verifySignature(raw, sig)) return NextResponse.json({ error: 'invalid_signature' }, { status: 401 })

  let body: any
  try { body = JSON.parse(raw) } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }) }

  const practiceId = String(body.practice_id ?? '')
  if (!practiceId) return NextResponse.json({ error: 'missing_practice_id' }, { status: 400 })

  const ins = await pool.query(
    `INSERT INTO era_remittances
       (practice_id, payer_name, payer_id, check_or_eft_number,
        payment_amount_cents, payment_date, raw_835_payload, parsed_summary, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, 'unmatched')
     RETURNING id`,
    [
      practiceId,
      body.payer_name ?? null, body.payer_id ?? null,
      body.check_or_eft_number ?? null,
      Number(body.payment_amount_cents ?? 0),
      body.payment_date ?? null,
      JSON.stringify(body.raw ?? body),
      JSON.stringify(body.summary ?? {}),
    ],
  )
  const eraId = ins.rows[0].id

  await writeAuditLog({
    practice_id: practiceId,
    action: 'era.received',
    resource_type: 'era_remittance', resource_id: eraId,
    severity: 'info',
    details: { payer_name: body.payer_name, payment_cents: body.payment_amount_cents, line_count: (body.lines ?? []).length },
  })

  const lines: ParsedLine[] = Array.isArray(body.lines) ? body.lines : []
  let autoMatched = 0
  for (const line of lines) {
    const m = await autoMatchEraLine(practiceId, line)
    await pool.query(
      `INSERT INTO era_claim_payments
         (era_id, practice_id, claim_id, patient_id, appointment_id, charge_id, invoice_id,
          service_date, cpt_code, billed_amount_cents, allowed_amount_cents,
          paid_amount_cents, patient_responsibility_cents, adjustment_codes,
          match_method, matched_at)
       VALUES ($1, $2, NULL, $3, $4, NULL, $5,
               $6, $7, $8, $9, $10, $11, $12::jsonb,
               $13, $14)`,
      [
        eraId, practiceId,
        m.patient_id, m.appointment_id, m.invoice_id,
        line.service_date ?? null, line.cpt_code ?? null,
        line.billed_amount_cents ?? null, line.allowed_amount_cents ?? null,
        line.paid_amount_cents ?? null, line.patient_responsibility_cents ?? null,
        JSON.stringify(line.adjustment_codes ?? []),
        m.method ? 'auto' : null,
        m.method ? new Date() : null,
      ],
    )
    if (m.method) autoMatched += 1
  }

  // Roll up remittance status.
  const newStatus = lines.length === 0 ? 'unmatched'
    : autoMatched === lines.length ? 'fully_matched'
    : autoMatched > 0 ? 'partially_matched' : 'unmatched'

  if (newStatus !== 'unmatched') {
    await pool.query(`UPDATE era_remittances SET status = $1 WHERE id = $2`, [newStatus, eraId])
  }

  if (autoMatched > 0) {
    await writeAuditLog({
      practice_id: practiceId,
      action: 'era.auto_matched',
      resource_type: 'era_remittance', resource_id: eraId,
      severity: 'info',
      details: { matched: autoMatched, total_lines: lines.length, status: newStatus },
    })
  }

  return NextResponse.json({ ok: true, era_id: eraId, lines: lines.length, auto_matched: autoMatched, status: newStatus })
}
