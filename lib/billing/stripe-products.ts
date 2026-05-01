// lib/billing/stripe-products.ts
//
// Harbor-as-vendor pricing tiers. This is the catalog charged to therapy
// practices for using Harbor (NOT patient-payment work — that lives in a
// separate pipeline).
//
// Founder will swap STRIPE_PRICE_ID_* env vars after the new C-corp Stripe
// account is provisioned post-EIN — no code changes required.

export type HarborTierKey =
  | 'reception_only_monthly'
  | 'solo_cash_pay_monthly'
  | 'solo_in_network_monthly'
  | 'group_practice_monthly'

export interface HarborTier {
  readonly key: HarborTierKey
  readonly name: string
  readonly description: string
  readonly interval: 'month'
  readonly amount_usd_cents: number
  /** Name of the env var that stores this tier's Stripe price ID. */
  readonly stripe_price_id_env: string
}

export const HARBOR_PRICING_TIERS = {
  reception_only_monthly: {
    key: 'reception_only_monthly',
    name: 'Reception',
    description:
      'AI receptionist for therapy practices that already have an EHR. Inbound call answering, intake capture, calendar sync (Google or Outlook), lead handoff via webhook or CSV.',
    interval: 'month',
    amount_usd_cents: 24900,
    stripe_price_id_env: 'STRIPE_PRICE_ID_RECEPTION_ONLY_MONTHLY',
  },
  solo_cash_pay_monthly: {
    key: 'solo_cash_pay_monthly',
    name: 'Solo (Cash-Pay)',
    description:
      'Single-provider cash-pay practice. Full Harbor EHR + AI receptionist; no insurance billing.',
    interval: 'month',
    amount_usd_cents: 14900,
    stripe_price_id_env: 'STRIPE_PRICE_ID_SOLO_CASH_PAY_MONTHLY',
  },
  solo_in_network_monthly: {
    key: 'solo_in_network_monthly',
    name: 'Solo (In-Network)',
    description:
      'Single-provider practice that bills insurance. Full Harbor EHR + AI receptionist + claim submission and ERA reconciliation.',
    interval: 'month',
    amount_usd_cents: 29900,
    stripe_price_id_env: 'STRIPE_PRICE_ID_SOLO_IN_NETWORK_MONTHLY',
  },
  group_practice_monthly: {
    key: 'group_practice_monthly',
    name: 'Group Practice',
    description:
      'Multi-provider group practice. Full Harbor EHR + AI receptionist + supervision/cosign workflows + multi-clinician scheduling.',
    interval: 'month',
    amount_usd_cents: 89900,
    stripe_price_id_env: 'STRIPE_PRICE_ID_GROUP_PRACTICE_MONTHLY',
  },
} as const satisfies Record<HarborTierKey, HarborTier>

export type HarborPricingTiers = typeof HARBOR_PRICING_TIERS

/**
 * Resolve a Stripe price ID for the given tier from env at request-time.
 * Returns null if the env var is unset (e.g. pre-EIN sandbox missing a tier).
 */
export function getStripePriceId(tier: HarborTierKey): string | null {
  const config = HARBOR_PRICING_TIERS[tier]
  if (!config) return null
  const value = process.env[config.stripe_price_id_env]
  return value && value.length > 0 ? value : null
}

/**
 * Reverse-lookup: given a Stripe price ID, find the tier key. Used by webhook
 * handlers to translate inbound `invoice.line_items[].price.id` back to the
 * canonical Harbor tier label for storage on practice_subscriptions.tier.
 */
export function tierFromStripePriceId(priceId: string | null | undefined): HarborTierKey | null {
  if (!priceId) return null
  for (const tier of Object.values(HARBOR_PRICING_TIERS)) {
    const envValue = process.env[tier.stripe_price_id_env]
    if (envValue && envValue === priceId) return tier.key as HarborTierKey
  }
  return null
}

export function getTier(tier: HarborTierKey): HarborTier {
  return HARBOR_PRICING_TIERS[tier]
}

export function listTiers(): readonly HarborTier[] {
  return Object.values(HARBOR_PRICING_TIERS) as readonly HarborTier[]
}

export function formatTierPrice(tier: HarborTierKey): string {
  const config = HARBOR_PRICING_TIERS[tier]
  const dollars = config.amount_usd_cents / 100
  return `$${dollars.toFixed(0)}/mo`
}
