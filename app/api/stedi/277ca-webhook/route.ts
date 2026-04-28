// app/api/stedi/277ca-webhook/route.ts
//
// Wave 41 / T5 patch — Stedi 277CA acknowledgment receiver.
//
// Stedi posts an HMAC-signed event whenever a 277CA acknowledgment
// is delivered for a previously-submitted 837 claim. We:
//   1. Verify the HMAC signature (mirror of the W41 T4 ERA webhook
//      pattern — header `stedi-signature`, secret in
//      STEDI_277CA_WEBHOOK_SECRET).
//   2. Parse the 277CA payload — extract the PCN (our identifier),
//      the PCCN (payer's identifier — `tradingPartnerClaimNumber`),
//      a normalized status (accepted/rejected/pending), and any
//      info/error messages the payer included.
//   3. Match the PCN to ehr_claim_submissions.pcn (case-insensitive
//      per Stedi guidance — payers often uppercase the PCN even if
//      we sent it as-is). Update the submission row with the
//      acknowledgment fields and flip is_in_adjudication=true iff a
//      PCCN was assigned.
//   4. Audit: claim.acknowledgment_received (severity warn if
//      rejected, info otherwise).
//
// PCCN extraction path (Stedi-normalized 277CA):
//   transactions[].payers[].claimStatusTransactions[]
//     .claimStatusDetails[].patientClaimStatusDetails[].claims[]
//       .claimStatus.tradingPartnerClaimNumber
//
// /api/stedi/ is already in PUBLIC_API_PREFIXES (W41 T4); the HMAC
// IS the auth.

import { NextResponse, type NextRequest } from 'next/server'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { pool } from '@/lib/aws/db'
import { auditSystemEvent } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function verifyHmac(body: string, signatureHeader: string | null): boolean {
  const secret = process.env.STEDI_277CA_WEBHOOK_SECRET
  if (!secret) return false
  if (!signatureHeader) return false
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

type AckMessage = { code?: string; text?: string; severity?: 'info' | 'error' }

type ParsedAck = {
  pcn: string | null
  pccn: string | null
  status: 'accepted' | 'rejected' | 'pending'
  messages: AckMessage[]
}

/**
 * Walk a Stedi-normalized 277CA payload extracting the PCN/PCCN/status
 * tuple. We tolerate minor key-shape variation — Stedi normalizes
 * across many payer sources and the wire shape drifts.
 *
 * Returns one ack per claim found; in practice 277CA files are
 * single-claim but the spec allows batches.
 */
function parse277Ca(payload: any): ParsedAck[] {
  const out: ParsedAck[] = []
  const transactions: any[] = payload?.transactions ?? []
  for (const tx of transactions) {
    const payers: any[] = tx?.payers ?? []
    for (const payer of payers) {
      const cstxs: any[] = payer?.claimStatusTransactions ?? []
      for (const cstx of cstxs) {
        const csds: any[] = cstx?.claimStatusDetails ?? []
        for (const csd of csds) {
          const psds: any[] = csd?.patientClaimStatusDetails ?? []
          for (const psd of psds) {
            const claims: any[] = psd?.claims ?? []
            for (const claim of claims) {
              const status = claim?.claimStatus ?? {}
              const pcn: string | null =
                claim?.patientControlNumber ??
                status?.patientControlNumber ??
                claim?.patientAccountNumber ??
                null
              const pccn: string | null =
                status?.tradingPartnerClaimNumber ??
                claim?.tradingPartnerClaimNumber ??
                null

              // Status mapping. Stedi normalizes the X12 STC01 health-care-
              // claim-status-category-code into a string like 'A1'/'A2'
              // ('Acknowledgment/Receipt'), 'A3' ('Returned'), 'F0'/'F1'
              // ('Finalized'), etc. We collapse to the three buckets the
              // UI cares about.
              const cat: string = String(status?.healthCareClaimStatusCategoryCode ?? status?.statusCategoryCode ?? '').toUpperCase()
              let normalized: 'accepted' | 'rejected' | 'pending' = 'pending'
              if (cat.startsWith('A1') || cat.startsWith('A2') || cat === 'A0' || cat.startsWith('F')) {
                // A0/A1/A2 = receipt / accepted by destination; F* = finalized
                normalized = 'accepted'
              } else if (cat.startsWith('A3') || cat.startsWith('A4') || cat.startsWith('A5') || cat.startsWith('A6') || cat.startsWith('A7') || cat.startsWith('A8') || cat.startsWith('D') || cat.startsWith('E')) {
                // A3-A8 = returned/rejected by various levels; D* = data correction; E* = response not possible (treat as rejected so the
                // therapist follows up)
                normalized = 'rejected'
              } else if (cat.startsWith('P')) {
                normalized = 'pending'
              }

              // Messages (info + error) — Stedi flattens these into
              // `claimStatusInformations` / `freeFormMessageText`.
              const messages: AckMessage[] = []
              const sis: any[] = status?.claimStatusInformations ?? claim?.claimStatusInformations ?? []
              for (const si of sis) {
                const text: string =
                  si?.healthCareClaimStatusInformationDescription ??
                  si?.statusInformationDescription ??
                  si?.description ??
                  si?.text ??
                  ''
                const code: string =
                  si?.healthCareClaimStatusInformationCode ??
                  si?.statusInformationCode ??
                  si?.code ??
                  ''
                if (text || code) {
                  messages.push({
                    code: code || undefined,
                    text: text || undefined,
                    severity: normalized === 'rejected' ? 'error' : 'info',
                  })
                }
              }
              const free = status?.freeFormMessageText ?? claim?.freeFormMessageText
              if (typeof free === 'string' && free.length > 0) {
                messages.push({ text: free, severity: normalized === 'rejected' ? 'error' : 'info' })
              }

              if (pcn || pccn) {
                out.push({ pcn, pccn, status: normalized, messages })
              }
            }
          }
        }
      }
    }
  }
  return out
}

export async function POST(req: NextRequest) {
  const raw = await req.text()
  const sig = req.headers.get('stedi-signature') || req.headers.get('x-stedi-signature')

  if (!verifyHmac(raw, sig)) {
    await auditSystemEvent({
      action: 'claim.acknowledgment_received',
      severity: 'warning',
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

  const acks = parse277Ca(payload)
  if (acks.length === 0) {
    await auditSystemEvent({
      action: 'claim.acknowledgment_received',
      severity: 'warning',
      details: { outcome: 'no_claims_in_277ca', stedi_event_id: payload?.eventId ?? null },
    })
    return NextResponse.json({ ok: true, matched: 0 })
  }

  let matched = 0
  let rejectedCount = 0
  for (const ack of acks) {
    if (!ack.pcn) continue
    // Match case-insensitively per Stedi guidance — payers often
    // uppercase the PCN even if we sent it as-is. Our generator
    // emits uppercase already, so this is mostly a belt-and-braces
    // safeguard for inbound matching across older rows.
    const sub = await pool.query(
      `SELECT id, practice_id, invoice_id
         FROM ehr_claim_submissions
        WHERE upper(pcn) = upper($1)
        ORDER BY submitted_at DESC
        LIMIT 1`,
      [ack.pcn],
    ).catch(() => ({ rows: [] as any[] }))

    if (sub.rows.length === 0) {
      await auditSystemEvent({
        action: 'claim.acknowledgment_received',
        severity: 'warning',
        details: { outcome: 'pcn_no_match', pcn: ack.pcn },
      })
      continue
    }

    const row = sub.rows[0]
    matched++
    if (ack.status === 'rejected') rejectedCount++

    await pool.query(
      `UPDATE ehr_claim_submissions
          SET payer_claim_control_number = COALESCE($1, payer_claim_control_number),
              acknowledgment_status      = $2,
              acknowledgment_received_at = NOW(),
              acknowledgment_messages    = $3::jsonb,
              is_in_adjudication         = is_in_adjudication OR ($1 IS NOT NULL)
        WHERE id = $4`,
      [ack.pccn, ack.status, JSON.stringify(ack.messages), row.id],
    ).catch((err) => {
      console.error('[277ca-webhook] update failed:', (err as Error).message)
    })

    // Mirror the acknowledgment status onto ehr_invoices.submission_status
    // so the existing invoice-listing UI surfaces rejected claims without
    // joining ehr_claim_submissions on every render.
    if (ack.status === 'rejected') {
      await pool.query(
        `UPDATE ehr_invoices SET submission_status = 'rejected', updated_at = NOW()
          WHERE id = $1 AND practice_id = $2`,
        [row.invoice_id, row.practice_id],
      ).catch(() => {})
    } else if (ack.status === 'accepted') {
      // Only flip to 'accepted' if not already 'paid' — ERA matching from
      // W41 T4 is the source of truth for paid status and we don't want
      // to regress.
      await pool.query(
        `UPDATE ehr_invoices SET submission_status = 'accepted', updated_at = NOW()
          WHERE id = $1 AND practice_id = $2 AND submission_status NOT IN ('paid','denied')`,
        [row.invoice_id, row.practice_id],
      ).catch(() => {})
    }

    await auditSystemEvent({
      action: 'claim.acknowledgment_received',
      severity: ack.status === 'rejected' ? 'warning' : 'info',
      practiceId: row.practice_id,
      resourceType: 'ehr_claim_submission',
      resourceId: row.id,
      details: {
        invoice_id: row.invoice_id,
        pcn: ack.pcn,
        pccn: ack.pccn,
        status: ack.status,
        message_count: ack.messages.length,
      },
    })
  }

  return NextResponse.json({
    ok: true,
    received: acks.length,
    matched,
    rejected: rejectedCount,
  })
}
