// app/api/stedi/era-webhook/route.ts
//
// Wave 41 / T4 — Stedi 835 ERA webhook receiver.
//
// Stedi posts an HMAC-signed event whenever an 835 ERA is delivered
// to our trading-partner endpoint. We:
//   1. Verify the signature (header `stedi-signature`, secret in
//      STEDI_ERA_WEBHOOK_SECRET).
//   2. Look up the practice by the recipient identifier on the file
//      (Stedi configures one webhook per practice, so we ALSO accept
//      a practice_id query param on the webhook URL as the lookup key
//      — saves a separate payer→practice routing table).
//   3. Insert ehr_era_files + parsed ehr_era_claim_payments rows.
//   4. Auto-match each claim_reference to ehr_invoices.id; mark the
//      ones that matched. Bulk-update parent file status accordingly.
//   5. Audit: era.received + era.parsed (+ era.matched_auto for
//      every auto-match).
//
// This route is in PUBLIC_API_PREFIXES so the middleware doesn't
// gate it on a Cognito session — Stedi obviously doesn't have one.
// HMAC verification IS the auth.

import { NextResponse, type NextRequest } from 'next/server'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { pool } from '@/lib/aws/db'
import { auditSystemEvent } from '@/lib/aws/ehr/audit'
import { parseStediEra } from '@/lib/aws/stedi/era-parse'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function verifyHmac(body: string, signatureHeader: string | null): boolean {
  const secret = process.env.STEDI_ERA_WEBHOOK_SECRET
  if (!secret) {
    // No secret configured -> reject. Operator must set the env var
    // before live ERA traffic flows.
    return false
  }
  if (!signatureHeader) return false
  // Stedi signatures are typically `t=<unix>,v1=<hexHmac>` or just `<hexHmac>`.
  // Accept either; extract v1 if present.
  let candidate = signatureHeader
  const v1Match = signatureHeader.match(/v1=([0-9a-f]+)/i)
  if (v1Match) candidate = v1Match[1]
  const expected = createHmac('sha256', secret).update(body, 'utf8').digest('hex')
  if (candidate.length !== expected.length) return false
  try {
    return timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(expected, 'hex'))
  } catch {
    return false
  }
}

export async function POST(req: NextRequest) {
  const raw = await req.text()
  const sig = req.headers.get('stedi-signature') || req.headers.get('x-stedi-signature')

  if (!verifyHmac(raw, sig)) {
    await auditSystemEvent({
      action: 'era.received',
      severity: 'warn',
      details: { outcome: 'signature_invalid_or_secret_missing' },
    })
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 })
  }

  let payload: any
  try {
    payload = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }

  // Practice lookup. Prefer the query param (Stedi configures one
  // webhook URL per trading-partner practice in our setup); fall back
  // to a payload-embedded practice_id we set in metadata when we
  // configured the trading partner; finally, if neither is present,
  // bail without writing anything.
  const practiceId =
    req.nextUrl.searchParams.get('practice_id') ??
    payload?.metadata?.practice_id ??
    null
  if (!practiceId) {
    await auditSystemEvent({
      action: 'era.received',
      severity: 'error',
      details: { outcome: 'no_practice_id_on_webhook' },
    })
    return NextResponse.json({ error: 'practice_id required' }, { status: 400 })
  }

  const stediEventId = payload?.eventId ?? payload?.id ?? null
  const stediFileId = payload?.fileId ?? payload?.file?.id ?? null
  const parsed = parseStediEra(payload)

  // Insert the parent file row (idempotent on stedi_event_id).
  let fileRowId: string | null = null
  try {
    const ins = await pool.query(
      `INSERT INTO ehr_era_files
         (practice_id, stedi_event_id, stedi_file_id, payer_id, payer_name,
          check_or_eft_number, payment_method, payment_amount_cents,
          payment_date, raw_payload, status, parse_error, parsed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb,
               CASE WHEN $11 IS NULL THEN 'parsed' ELSE 'error' END,
               $11,
               CASE WHEN $11 IS NULL THEN NOW() ELSE NULL END)
       ON CONFLICT (practice_id, stedi_event_id) DO NOTHING
       RETURNING id`,
      [
        practiceId, stediEventId, stediFileId, parsed.payer_id, parsed.payer_name,
        parsed.check_or_eft_number, parsed.payment_method, parsed.payment_amount_cents,
        parsed.payment_date, JSON.stringify(payload), parsed.parse_error,
      ],
    )
    fileRowId = ins.rows[0]?.id ?? null
  } catch (err) {
    console.error('[era-webhook] file insert failed:', (err as Error).message)
    return NextResponse.json({ error: 'storage error' }, { status: 500 })
  }

  if (!fileRowId) {
    // Duplicate — already received. Idempotent return.
    return NextResponse.json({ ok: true, deduped: true })
  }

  await auditSystemEvent({
    action: 'era.received',
    severity: 'info',
    practiceId,
    resourceType: 'ehr_era_file',
    resourceId: fileRowId,
    details: { stedi_event_id: stediEventId, claim_count: parsed.claims.length },
  })

  // Insert claim-payment rows + auto-match.
  let autoMatched = 0
  for (const c of parsed.claims) {
    let matchedInvoiceId: string | null = null
    if (c.claim_reference && /^[0-9a-f-]{36}$/i.test(c.claim_reference)) {
      const m = await pool.query(
        `SELECT id FROM ehr_invoices
          WHERE id = $1 AND practice_id = $2 LIMIT 1`,
        [c.claim_reference, practiceId],
      ).catch(() => ({ rows: [] as any[] }))
      if (m.rows.length > 0) matchedInvoiceId = c.claim_reference
    }

    try {
      const ins = await pool.query(
        `INSERT INTO ehr_era_claim_payments
           (era_file_id, practice_id, claim_reference, patient_account_number,
            payer_claim_control_no, charge_amount_cents, paid_amount_cents,
            patient_responsibility_cents, adjustments_json, service_lines_json,
            claim_status_code, matched_invoice_id, match_kind, matched_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb,
                 $11, $12,
                 CASE WHEN $12 IS NOT NULL THEN 'auto' ELSE 'unmatched' END,
                 CASE WHEN $12 IS NOT NULL THEN NOW() ELSE NULL END)
         RETURNING id`,
        [
          fileRowId, practiceId, c.claim_reference, c.patient_account_number,
          c.payer_claim_control_no, c.charge_amount_cents, c.paid_amount_cents,
          c.patient_responsibility_cents,
          c.adjustments ? JSON.stringify(c.adjustments) : null,
          c.service_lines ? JSON.stringify(c.service_lines) : null,
          c.claim_status_code, matchedInvoiceId,
        ],
      )

      if (matchedInvoiceId) {
        autoMatched++
        // Apply paid_cents to the matched invoice + flip status.
        await pool.query(
          `UPDATE ehr_invoices
              SET paid_cents = paid_cents + $1,
                  status     = CASE
                                 WHEN paid_cents + $1 >= total_cents THEN 'paid'
                                 WHEN paid_cents + $1 > 0           THEN 'partial'
                                 ELSE status
                               END,
                  paid_at    = CASE
                                 WHEN paid_cents + $1 >= total_cents AND paid_at IS NULL THEN NOW()
                                 ELSE paid_at
                               END,
                  updated_at = NOW()
            WHERE id = $2 AND practice_id = $3`,
          [c.paid_amount_cents, matchedInvoiceId, practiceId],
        ).catch(() => {})

        await auditSystemEvent({
          action: 'era.matched_auto',
          severity: 'info',
          practiceId,
          resourceType: 'ehr_era_claim_payment',
          resourceId: ins.rows[0].id,
          details: {
            invoice_id: matchedInvoiceId,
            paid_amount_cents: c.paid_amount_cents,
            era_file_id: fileRowId,
          },
        })
      }
    } catch (err) {
      console.error('[era-webhook] claim insert failed:', (err as Error).message)
    }
  }

  // Update parent file status reflecting match outcome.
  let parentStatus = 'parsed'
  if (parsed.claims.length > 0) {
    if (autoMatched === parsed.claims.length) parentStatus = 'matched'
    else if (autoMatched > 0) parentStatus = 'partially_matched'
    else parentStatus = 'manual_review'
  }
  await pool.query(
    `UPDATE ehr_era_files SET status = $1 WHERE id = $2`,
    [parentStatus, fileRowId],
  ).catch(() => {})

  await auditSystemEvent({
    action: 'era.parsed',
    severity: 'info',
    practiceId,
    resourceType: 'ehr_era_file',
    resourceId: fileRowId,
    details: {
      claim_count: parsed.claims.length,
      auto_matched: autoMatched,
      file_status: parentStatus,
    },
  })

  return NextResponse.json({
    ok: true,
    file_id: fileRowId,
    claim_count: parsed.claims.length,
    auto_matched: autoMatched,
  })
}
