// lib/billing/email-templates/index.ts
//
// Stubbed dunning + lifecycle email templates. The transactional-email
// pipeline (SES + renderer + send queue) is on a separate branch that
// hasn't merged onto parallel/aws-v1 yet, so these are PURE STRING-RETURN
// stubs. The webhook + dunning cron call into them and currently log the
// rendered subject/body to CloudWatch. When the email pipeline lands,
// replace each render_* with a real renderEmail() / sendEmail() call.
//
// TODO: wire to lib/email-* once transactional-email pipeline is merged.

export type DunningTemplateKey =
  | 'subscription-payment-failed-day-0'
  | 'subscription-payment-failed-day-3'
  | 'subscription-payment-failed-day-7'
  | 'subscription-payment-failed-day-14-suspending'
  | 'subscription-trial-ending-3-days'
  | 'subscription-canceled'

export interface DunningEmailContext {
  practiceName: string
  ownerEmail: string
  amountDueCents?: number
  trialEndsAt?: string | null
  hostedInvoiceUrl?: string | null
  customerPortalUrl?: string | null
}

const SUBJECTS: Record<DunningTemplateKey, string> = {
  'subscription-payment-failed-day-0':
    'Payment failed on your Harbor subscription',
  'subscription-payment-failed-day-3':
    'Reminder: please update your Harbor payment method',
  'subscription-payment-failed-day-7':
    'Action required: your Harbor account is at risk of suspension',
  'subscription-payment-failed-day-14-suspending':
    'Your Harbor account has been suspended',
  'subscription-trial-ending-3-days':
    'Your Harbor trial ends in 3 days',
  'subscription-canceled':
    'Your Harbor subscription has been canceled',
}

const BODIES: Record<DunningTemplateKey, (ctx: DunningEmailContext) => string> = {
  'subscription-payment-failed-day-0': (ctx) => `Hi ${ctx.practiceName},

We weren't able to charge your card for your latest Harbor invoice. No
action is required immediately — Stripe will retry the charge automatically.
You can update your payment method in the Customer Portal at any time:
${ctx.customerPortalUrl ?? '[Customer Portal link]'}

If you have questions, reply to this email.

— Harbor`,
  'subscription-payment-failed-day-3': (ctx) => `Hi ${ctx.practiceName},

We're still seeing a payment failure on your Harbor subscription. Please
update your card to keep your account in good standing:
${ctx.customerPortalUrl ?? '[Customer Portal link]'}

— Harbor`,
  'subscription-payment-failed-day-7': (ctx) => `Hi ${ctx.practiceName},

Your Harbor subscription has been past-due for 7 days. If we can't collect
payment by day 14, the account will be suspended and Harbor features
(scheduling, AI receptionist, EHR) will pause.

Update your payment method now:
${ctx.customerPortalUrl ?? '[Customer Portal link]'}

— Harbor`,
  'subscription-payment-failed-day-14-suspending': (ctx) => `Hi ${ctx.practiceName},

Your Harbor account has been suspended after 14 days of unpaid invoices.
Your data is preserved — once you update your payment method and the next
charge succeeds, full access is restored.

Update your payment method:
${ctx.customerPortalUrl ?? '[Customer Portal link]'}

— Harbor`,
  'subscription-trial-ending-3-days': (ctx) => `Hi ${ctx.practiceName},

Your Harbor trial ends on ${ctx.trialEndsAt ?? '[trial end date]'}. Your
saved card will be charged automatically. You can change plan or cancel
any time before then.

— Harbor`,
  'subscription-canceled': (ctx) => `Hi ${ctx.practiceName},

Your Harbor subscription has been canceled. We'd love to know what we
could have done better — reply to this email any time.

— Harbor`,
}

export function renderDunningEmail(
  template: DunningTemplateKey,
  context: DunningEmailContext,
): { subject: string; text: string } {
  return {
    subject: SUBJECTS[template],
    text: BODIES[template](context),
  }
}
