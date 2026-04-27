// lib/aws/ehr/cancellation-policy.ts
//
// Wave 42 — Practice-level cancellation policy + late-fee enforcement.
//
// One library is the source of truth for:
//
//   1. assessing whether a given appointment cancellation arrived inside
//      the practice's notice window
//   2. charging the patient's saved Stripe card for the late-cancel fee
//   3. charging the patient's saved Stripe card for the no-show fee
//   4. waiving (refunding) either fee under therapist override
//
// Design rules:
//   - NEVER block the cancellation/no-show on a Stripe failure. If the
//     charge declines we mark the fee as billable (NULL stays in the
//     `*_charged_cents` column with a row in audit_logs explaining why).
//   - Late-cancel and no-show fees use independent Stripe charges so a
//     therapist waiver of one is atomic.
//   - Therapist-initiated cancellations DO NOT trigger fees — only when
//     the source is patient/portal/voice or a no-show transition.
//   - If practices.cancellation_policy_hours IS NULL, the policy is
//     considered disabled and we no-op.

import Stripe from 'stripe'
import { pool } from '@/lib/aws/db'
import { stripe, isStripeConfigured } from '@/lib/stripe'
import { auditEhrAccess, auditSystemEvent, type EhrAuditAction } from '@/lib/aws/ehr/audit'
import type { ApiAuthContext } from '@/lib/aws/api-auth'

export type CancellationSource = 'patient' | 'portal' | 'voice' | 'system' | 'therapist'

export interface PolicyAssessment {
  /** appointment exists and is bound to a practice */
  found: boolean
  /** practice has opted in to the policy at all */
  enabled: boolean
  /** notice window in hours; null when disabled */
  policyHours: number | null
  /** difference, in hours, between scheduled_for and now (negative = past) */
  hoursUntil: number | null
  /** late = within the window (strictly fewer hours than the threshold) */
  late: boolean
  /** late-cancel fee amount in cents (may be null if hours threshold set but fee unset) */
  cancellationFeeCents: number | null
  /** no-show fee amount in cents */
  noShowFeeCents: number | null
}

export type EnforceStatus =
  | 'on_time'              // outside the window — no fee
  | 'no_policy'            // policy disabled or no fee configured
  | 'already_charged'      // appointment already had a fee charged for this kind
  | 'charged'              // Stripe charge succeeded
  | 'billable'             // patient has no card / no Stripe — surface on invoice flow
  | 'failed'               // Stripe call threw; charge not captured
  | 'not_found'            // appointment id missing

export interface EnforceResult {
  status: EnforceStatus
  amountCents?: number
  stripeChargeId?: string | null
  paymentIntentId?: string | null
  reason?: string
}

/**
 * Assess the policy for a given appointment. Returns enabled=false /
 * late=false when the practice has not opted in.
 */
export async function assessCancellationPolicy(appointmentId: string): Promise<PolicyAssessment> {
  const { rows } = await pool.query(
    `SELECT a.id, a.scheduled_for, a.practice_id,
            p.cancellation_policy_hours,
            p.cancellation_fee_cents,
            p.no_show_fee_cents
       FROM appointments a
       JOIN practices p ON p.id = a.practice_id
      WHERE a.id = $1
      LIMIT 1`,
    [appointmentId],
  )
  const r = rows[0]
  if (!r) {
    return { found: false, enabled: false, policyHours: null, hoursUntil: null, late: false, cancellationFeeCents: null, noShowFeeCents: null }
  }
  const policyHours: number | null = r.cancellation_policy_hours ?? null
  const cancellationFeeCents: number | null = r.cancellation_fee_cents ?? null
  const noShowFeeCents: number | null = r.no_show_fee_cents ?? null
  if (policyHours == null || !r.scheduled_for) {
    return { found: true, enabled: false, policyHours, hoursUntil: null, late: false, cancellationFeeCents, noShowFeeCents }
  }
  const hoursUntil = (new Date(r.scheduled_for).getTime() - Date.now()) / 3_600_000
  return {
    found: true,
    enabled: true,
    policyHours,
    hoursUntil,
    late: hoursUntil < policyHours,
    cancellationFeeCents,
    noShowFeeCents,
  }
}

interface AppointmentJoinRow {
  practice_id: string
  patient_id: string
  scheduled_for: string
  cancellation_fee_cents: number | null
  no_show_fee_cents: number | null
  cancellation_fee_charged_cents: number | null
  no_show_fee_charged_cents: number | null
  cancellation_fee_stripe_charge_id: string | null
  no_show_fee_stripe_charge_id: string | null
  late_canceled_at: string | null
  pat_stripe_customer_id: string | null
}

async function loadAppointmentForFee(appointmentId: string): Promise<AppointmentJoinRow | null> {
  const { rows } = await pool.query(
    `SELECT a.practice_id,
            a.patient_id,
            a.scheduled_for,
            a.cancellation_fee_charged_cents,
            a.no_show_fee_charged_cents,
            a.cancellation_fee_stripe_charge_id,
            a.no_show_fee_stripe_charge_id,
            a.late_canceled_at,
            p.cancellation_fee_cents,
            p.no_show_fee_cents,
            pat.stripe_customer_id AS pat_stripe_customer_id
       FROM appointments a
       JOIN practices p   ON p.id  = a.practice_id
       JOIN patients pat  ON pat.id = a.patient_id
      WHERE a.id = $1
      LIMIT 1`,
    [appointmentId],
  )
  return (rows[0] as AppointmentJoinRow | undefined) ?? null
}

/**
 * Find a usable saved card for a Stripe customer. Prefers the customer's
 * invoice_settings.default_payment_method, falls back to the most recent
 * card payment method. Returns null when there is no usable card on file.
 */
async function findDefaultCardPaymentMethod(customerId: string): Promise<string | null> {
  if (!stripe) return null
  try {
    const customer = await stripe.customers.retrieve(customerId)
    if (typeof customer === 'string' || ('deleted' in customer && customer.deleted)) return null
    const dflt = (customer as Stripe.Customer).invoice_settings?.default_payment_method
    if (dflt) return typeof dflt === 'string' ? dflt : dflt.id
    const pms = await stripe.paymentMethods.list({ customer: customerId, type: 'card', limit: 1 })
    return pms.data[0]?.id ?? null
  } catch (err) {
    console.error('[cancellation-policy] customer lookup failed:', (err as Error).message)
    return null
  }
}

interface FeeChargeArgs {
  appointmentId: string
  source: CancellationSource
  kind: 'late_cancel' | 'no_show'
}

async function chargeFee({ appointmentId, source, kind }: FeeChargeArgs): Promise<EnforceResult> {
  const row = await loadAppointmentForFee(appointmentId)
  if (!row) return { status: 'not_found' }

  const feeCents = kind === 'late_cancel' ? row.cancellation_fee_cents : row.no_show_fee_cents
  const alreadyCharged = kind === 'late_cancel'
    ? row.cancellation_fee_charged_cents
    : row.no_show_fee_charged_cents
  const chargeIdCol = kind === 'late_cancel' ? 'cancellation_fee_stripe_charge_id' : 'no_show_fee_stripe_charge_id'
  const amtCol = kind === 'late_cancel' ? 'cancellation_fee_charged_cents' : 'no_show_fee_charged_cents'

  if (alreadyCharged != null && alreadyCharged > 0) {
    // Don't double-charge if a previous attempt already succeeded.
    return { status: 'already_charged', amountCents: alreadyCharged }
  }
  if (!feeCents || feeCents <= 0) {
    return { status: 'no_policy' }
  }

  const auditAction: EhrAuditAction = kind === 'late_cancel' ? 'cancellation_fee.charged' : 'no_show_fee.charged'
  const baseDetails = {
    fee_kind: kind,
    amount_cents: feeCents,
    source,
    appointment_id: appointmentId,
  }

  if (!isStripeConfigured() || !stripe) {
    await auditSystemEvent({
      action: auditAction,
      practiceId: row.practice_id,
      resourceType: 'appointment',
      resourceId: appointmentId,
      severity: 'warn',
      details: { ...baseDetails, billable: true, reason: 'stripe_not_configured' },
    })
    return { status: 'billable', amountCents: feeCents, reason: 'stripe_not_configured' }
  }

  const customerId = row.pat_stripe_customer_id
  if (!customerId) {
    await auditSystemEvent({
      action: auditAction,
      practiceId: row.practice_id,
      resourceType: 'appointment',
      resourceId: appointmentId,
      details: { ...baseDetails, billable: true, reason: 'no_stripe_customer' },
    })
    return { status: 'billable', amountCents: feeCents, reason: 'no_stripe_customer' }
  }

  const paymentMethodId = await findDefaultCardPaymentMethod(customerId)
  if (!paymentMethodId) {
    await auditSystemEvent({
      action: auditAction,
      practiceId: row.practice_id,
      resourceType: 'appointment',
      resourceId: appointmentId,
      details: { ...baseDetails, billable: true, reason: 'no_saved_card' },
    })
    return { status: 'billable', amountCents: feeCents, reason: 'no_saved_card' }
  }

  try {
    const intent = await stripe.paymentIntents.create({
      customer: customerId,
      amount: feeCents,
      currency: 'usd',
      payment_method: paymentMethodId,
      off_session: true,
      confirm: true,
      description:
        kind === 'late_cancel'
          ? `Late-cancellation fee — appointment ${appointmentId}`
          : `No-show fee — appointment ${appointmentId}`,
      metadata: {
        harbor_practice_id: row.practice_id,
        harbor_appointment_id: appointmentId,
        harbor_patient_id: row.patient_id,
        harbor_fee_kind: kind,
        harbor_source: source,
      },
    })
    const chargeId = typeof intent.latest_charge === 'string'
      ? intent.latest_charge
      : intent.latest_charge?.id ?? null

    await pool.query(
      `UPDATE appointments
          SET ${amtCol} = $1,
              ${chargeIdCol} = $2
        WHERE id = $3`,
      [feeCents, chargeId, appointmentId],
    )

    await auditSystemEvent({
      action: auditAction,
      practiceId: row.practice_id,
      resourceType: 'appointment',
      resourceId: appointmentId,
      details: {
        ...baseDetails,
        stripe_charge_id: chargeId,
        stripe_payment_intent: intent.id,
        billable: false,
      },
    })

    return { status: 'charged', amountCents: feeCents, stripeChargeId: chargeId, paymentIntentId: intent.id }
  } catch (err) {
    const msg = (err as Error).message
    console.error('[cancellation-policy] charge failed:', msg)
    await auditSystemEvent({
      action: auditAction,
      practiceId: row.practice_id,
      resourceType: 'appointment',
      resourceId: appointmentId,
      severity: 'warn',
      details: { ...baseDetails, billable: true, reason: 'stripe_error', error: msg },
    })
    return { status: 'failed', amountCents: feeCents, reason: msg }
  }
}

/**
 * Patient-initiated cancellation. If the practice has a policy and the
 * cancellation arrived inside the notice window, attempts a Stripe
 * charge for the late-cancel fee. Returns 'on_time' / 'no_policy' for
 * skipped paths so callers can branch on the user-facing message.
 *
 * The appointment row is also tagged with late_canceled_at when the
 * cancellation fell inside the policy window — even if the fee charge
 * itself becomes billable / fails — so that ledgers can reconcile.
 */
export async function enforceLateCancelFee(
  appointmentId: string,
  source: CancellationSource,
): Promise<EnforceResult> {
  if (source === 'therapist' || source === 'system') {
    // Therapist or system-initiated cancellation — no fee per policy.
    return { status: 'no_policy', reason: 'therapist_initiated' }
  }
  const assessment = await assessCancellationPolicy(appointmentId)
  if (!assessment.found) return { status: 'not_found' }
  if (!assessment.enabled) return { status: 'no_policy' }
  if (!assessment.late) return { status: 'on_time' }

  // Mark late_canceled_at unconditionally — the policy was crossed.
  await pool.query(
    `UPDATE appointments
        SET late_canceled_at = COALESCE(late_canceled_at, NOW())
      WHERE id = $1`,
    [appointmentId],
  )

  return chargeFee({ appointmentId, source, kind: 'late_cancel' })
}

/**
 * Triggered when an appointment status transitions to 'no_show'. Charges
 * the practice's no_show_fee_cents, falling back to billable if no card.
 */
export async function enforceNoShowFee(
  appointmentId: string,
  source: CancellationSource = 'system',
): Promise<EnforceResult> {
  return chargeFee({ appointmentId, source, kind: 'no_show' })
}

/**
 * Therapist-side waiver. Refunds the Stripe charge if one was captured,
 * sets the *_charged_cents column to 0, and writes an EHR audit row tied
 * to the therapist (so the action is non-repudiable).
 */
export async function waiveCancellationFee(args: {
  ctx: ApiAuthContext
  appointmentId: string
  kind: 'late_cancel' | 'no_show'
  reason?: string
}): Promise<{ refunded: boolean; refundId?: string; previouslyChargedCents: number; reason?: string }> {
  const row = await loadAppointmentForFee(args.appointmentId)
  if (!row) throw new Error('appointment_not_found')

  const chargeIdCol = args.kind === 'late_cancel' ? 'cancellation_fee_stripe_charge_id' : 'no_show_fee_stripe_charge_id'
  const amtCol = args.kind === 'late_cancel' ? 'cancellation_fee_charged_cents' : 'no_show_fee_charged_cents'
  const chargeId = args.kind === 'late_cancel' ? row.cancellation_fee_stripe_charge_id : row.no_show_fee_stripe_charge_id
  const charged = args.kind === 'late_cancel' ? row.cancellation_fee_charged_cents : row.no_show_fee_charged_cents

  let refundId: string | undefined
  let refunded = false
  if (chargeId && charged && charged > 0 && isStripeConfigured() && stripe) {
    try {
      const refund = await stripe.refunds.create({ charge: chargeId })
      refundId = refund.id
      refunded = true
    } catch (err) {
      console.error('[cancellation-policy] refund failed:', (err as Error).message)
      // Don't throw — therapist still gets to record the waiver. Audit
      // captures the failure so finance can chase it up.
    }
  }

  await pool.query(
    `UPDATE appointments
        SET ${amtCol} = 0,
            ${chargeIdCol} = NULL
      WHERE id = $1`,
    [args.appointmentId],
  )

  const auditAction: EhrAuditAction = args.kind === 'late_cancel' ? 'cancellation_fee.waived' : 'no_show_fee.waived'
  await auditEhrAccess({
    ctx: args.ctx,
    action: auditAction,
    resourceType: 'appointment',
    resourceId: args.appointmentId,
    details: {
      fee_kind: args.kind,
      previously_charged_cents: charged ?? 0,
      stripe_charge_id: chargeId,
      stripe_refund_id: refundId ?? null,
      refunded,
      reason: args.reason ?? null,
    },
  })

  return {
    refunded,
    refundId,
    previouslyChargedCents: charged ?? 0,
    reason: args.reason,
  }
}
