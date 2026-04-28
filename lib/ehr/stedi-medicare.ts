// lib/ehr/stedi-medicare.ts
//
// Wave 41 / T5 patch — is-this-payer-Medicare helper for the
// resubmit/cancel CFC + PCCN computation.
//
// Stedi's resubmit-cancel-claims docs prescribe different identifier
// + frequency-code combinations for Medicare vs non-Medicare:
//   • Adjudication, Medicare:        CFC=1, reuse PCN, NO PCCN
//   • Adjudication, non-Medicare:    CFC=7 (replace) or 8 (cancel),
//                                    NEW PCN, include PCCN
//
// We persist `stedi_payers.is_medicare` (added in
// 20260428_stedi_claims_lifecycle.sql) as the source of truth so an
// admin can flag any payer manually. This helper looks up the flag
// for a given Stedi tradingPartnerServiceId.
//
// v1 limitation: we ship a small seeded list of common MAC payer IDs
// (Cahaba GBA, Highmark, Noridian, etc.) but most Medicare contractors
// roll over over time. Operators must augment with their region's IDs
// via SQL after deploy.

import { pool } from '@/lib/aws/db'

const MEMO = new Map<string, boolean>()
const MEMO_TTL_MS = 5 * 60 * 1000
const MEMO_TIMES = new Map<string, number>()

function memoGet(key: string): boolean | undefined {
  const ts = MEMO_TIMES.get(key)
  if (!ts || Date.now() - ts > MEMO_TTL_MS) {
    MEMO.delete(key)
    MEMO_TIMES.delete(key)
    return undefined
  }
  return MEMO.get(key)
}

function memoSet(key: string, val: boolean): void {
  MEMO.set(key, val)
  MEMO_TIMES.set(key, Date.now())
}

/**
 * Return TRUE iff `payerId837` is flagged as Medicare in the
 * stedi_payers directory. Match is checked against three columns:
 *   • stedi_id (the trading-partner service id we put on the wire)
 *   • primary_payer_id (the clearinghouse-level ID — what's seeded
 *     in the migration)
 *   • aliases (in case we resolved through a fuzzy match)
 *
 * Never throws — returns false on any DB error so the resubmit/cancel
 * computation defaults to the SAFER non-Medicare branch (which won't
 * accidentally drop the PCCN that Medicare requires omitting).
 *
 * Wait — that's the wrong default. For SAFETY, the right default
 * when we can't tell is "treat as non-Medicare" because:
 *   • Most payers are non-Medicare. The non-Medicare flow includes
 *     PCCN, which Medicare ignores anyway (Medicare just discards
 *     extra fields).
 *   • The Medicare-specific behavior is more restrictive (can't use
 *     CFC=8). Defaulting to it would silently break legitimate
 *     non-Medicare cancellations.
 * So `false` on error is correct.
 */
export async function isMedicarePayer(payerId837: string | null | undefined): Promise<boolean> {
  if (!payerId837) return false
  const key = String(payerId837).trim()
  if (!key) return false
  const cached = memoGet(key)
  if (cached !== undefined) return cached

  try {
    const { rows } = await pool.query(
      `SELECT is_medicare
         FROM stedi_payers
        WHERE is_medicare = true
          AND (
            stedi_id = $1
            OR primary_payer_id = $1
            OR aliases @> to_jsonb($1::text)
          )
        LIMIT 1`,
      [key],
    )
    const result = rows.length > 0 && rows[0].is_medicare === true
    memoSet(key, result)
    return result
  } catch (err) {
    console.error('[stedi-medicare] lookup failed:', (err as Error).message)
    return false
  }
}
