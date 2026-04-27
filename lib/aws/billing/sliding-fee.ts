// lib/aws/billing/sliding-fee.ts
//
// Wave 41 / T6 — pure helper that applies a sliding-fee discount to a
// base charge amount. No DB writes; the caller decides whether to
// persist the adjusted amount.
//
// Lookup precedence:
//   1. If practice.sliding_fee_enabled = false -> return base, tier=null
//   2. If patient.fee_tier IS NULL              -> return base, tier=null
//   3. Look up patient.fee_tier in practice.sliding_fee_config[].name
//        - found:    return Math.round(base * fee_pct / 100), tier=name
//        - not found: console.warn + return base, tier=null
//                     (silent skip; a misconfigured tier should never
//                      raise the patient's fee)

import type { PoolClient } from 'pg'
import { pool } from '@/lib/aws/db'

export interface SlidingFeeTier {
  name: string
  income_threshold_cents?: number | null
  fee_pct: number  // 0..100, integer or float
}

export interface ApplySlidingFeeResult {
  /** Adjusted fee (rounded). Equal to baseCents when no discount applied. */
  adjustedCents: number
  /** Tier name that was applied; null when no discount (off, no tier, or misconfigured). */
  tierApplied: string | null
  /** Discount percent applied (e.g. 50 if fee_pct was 50, meaning patient pays half). */
  feePct: number | null
}

/**
 * Apply sliding-fee discount. Reads practices.sliding_fee_enabled +
 * sliding_fee_config and patients.fee_tier in a single SQL round-trip.
 * If either lookup fails, returns the base unchanged.
 */
export async function applySlidingFee(args: {
  client?: PoolClient
  practiceId: string
  patientId: string
  baseCents: number
}): Promise<ApplySlidingFeeResult> {
  const q = (args.client ?? pool).query.bind(args.client ?? pool)

  let practiceRow: any = null
  let patientRow: any = null
  try {
    const r = await q(
      `SELECT pr.sliding_fee_enabled, pr.sliding_fee_config,
              p.fee_tier
         FROM practices pr
         LEFT JOIN patients p ON p.id = $2 AND p.practice_id = pr.id
        WHERE pr.id = $1
        LIMIT 1`,
      [args.practiceId, args.patientId],
    ) as { rows: any[] }
    practiceRow = r.rows[0] ?? null
    patientRow = r.rows[0] ?? null
  } catch {
    // Schema not migrated — fall through to no-op.
    return { adjustedCents: args.baseCents, tierApplied: null, feePct: null }
  }

  if (!practiceRow?.sliding_fee_enabled) {
    return { adjustedCents: args.baseCents, tierApplied: null, feePct: null }
  }
  const tier = patientRow?.fee_tier
  if (!tier) {
    return { adjustedCents: args.baseCents, tierApplied: null, feePct: null }
  }

  const config: SlidingFeeTier[] = Array.isArray(practiceRow.sliding_fee_config)
    ? practiceRow.sliding_fee_config
    : []
  const match = config.find((t) => t?.name === tier)
  if (!match) {
    // Misconfigured tier name. Don't raise the fee; warn for ops.
    console.warn(
      `[sliding-fee] patient ${args.patientId} has fee_tier='${tier}' but ` +
      `practice ${args.practiceId} sliding_fee_config has no matching tier. ` +
      `Charge falls back to full fee.`,
    )
    return { adjustedCents: args.baseCents, tierApplied: null, feePct: null }
  }

  const pct = Number(match.fee_pct)
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
    console.warn(
      `[sliding-fee] tier '${tier}' has invalid fee_pct=${match.fee_pct}; using full fee.`,
    )
    return { adjustedCents: args.baseCents, tierApplied: null, feePct: null }
  }

  const adjusted = Math.round(args.baseCents * pct / 100)
  return { adjustedCents: adjusted, tierApplied: match.name, feePct: pct }
}

/**
 * Validate a sliding_fee_config JSON value before persisting. Throws on
 * shape errors; returns the normalized array on success.
 */
export function validateSlidingFeeConfig(input: unknown): SlidingFeeTier[] {
  if (!Array.isArray(input)) throw new Error('sliding_fee_config must be an array')
  const seen = new Set<string>()
  const out: SlidingFeeTier[] = []
  for (const t of input) {
    if (!t || typeof t !== 'object') {
      throw new Error('each tier must be an object { name, fee_pct, ... }')
    }
    const name = String((t as any).name ?? '').trim()
    if (!name) throw new Error('tier name is required')
    if (seen.has(name)) throw new Error(`duplicate tier name: ${name}`)
    seen.add(name)

    const fee_pct = Number((t as any).fee_pct)
    if (!Number.isFinite(fee_pct) || fee_pct < 0 || fee_pct > 100) {
      throw new Error(`tier '${name}': fee_pct must be a number between 0 and 100`)
    }
    const income_threshold_cents = (t as any).income_threshold_cents
    out.push({
      name,
      fee_pct,
      income_threshold_cents:
        income_threshold_cents == null ? null : Number(income_threshold_cents) || 0,
    })
  }
  return out
}
