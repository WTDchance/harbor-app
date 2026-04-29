// lib/aws/sms-templates.ts
//
// Wave 50 — SMS appointment reminder pipeline templates.
//
// Six templates with a category enum + {{var}} substitution. Every
// template ends with the required A2P 10DLC opt-out tag ("Reply STOP
// to opt out") and is hard-capped at 320 chars (two SMS segments) so
// no message gets fragmented across three carrier hops.
//
// Categories map 1:1 to the cron threshold buckets + the inbound
// confirmation handler + the cancellation-fill outreach. Keeping this
// as a single typed map (instead of one constant per file) lets the
// cron and the manual "send a confirmation" surface share substitution
// + length validation.

export type SmsTemplateCategory =
  | 'reminder_24h'
  | 'reminder_2h'
  | 'reminder_30min'
  | 'appointment_confirmation'
  | 'appointment_cancellation'
  | 'cancellation_fill_offer'

export type SmsTemplateVars = Record<string, string | number | null | undefined>

interface TemplateDef {
  category: SmsTemplateCategory
  body: string
}

const MAX_BODY_CHARS = 320
const OPT_OUT_TAG = 'Reply STOP to opt out.'

// ---------------------------------------------------------------------------
// Templates
//
// All copy is deliberately therapy-neutral — never names a diagnosis or
// treatment in the body, since SMS is an unencrypted channel. Practice
// name + therapist first name are the most identifying details we'll
// include.
// ---------------------------------------------------------------------------
const TEMPLATES: Record<SmsTemplateCategory, TemplateDef> = {
  reminder_24h: {
    category: 'reminder_24h',
    body:
      'Hi {{first_name}}, this is a reminder from {{practice_name}} that you have an appointment with {{therapist_name}} tomorrow at {{appt_time_local}}. Reply C to confirm or R to reschedule. ' +
      OPT_OUT_TAG,
  },
  reminder_2h: {
    category: 'reminder_2h',
    body:
      '{{practice_name}}: {{first_name}}, your appointment with {{therapist_name}} is in 2 hours at {{appt_time_local}}. Reply C to confirm. ' +
      OPT_OUT_TAG,
  },
  reminder_30min: {
    category: 'reminder_30min',
    body:
      '{{practice_name}}: see you in 30 min, {{first_name}}. {{therapist_name}} at {{appt_time_local}}. Reply R if you need to reschedule. ' +
      OPT_OUT_TAG,
  },
  appointment_confirmation: {
    category: 'appointment_confirmation',
    body:
      'Thanks {{first_name}}! Your appointment with {{therapist_name}} on {{appt_time_local}} is confirmed. {{practice_name}}. ' +
      OPT_OUT_TAG,
  },
  appointment_cancellation: {
    category: 'appointment_cancellation',
    body:
      '{{practice_name}}: your appointment with {{therapist_name}} on {{appt_time_local}} has been cancelled. To rebook, call {{practice_phone}} or reply R. ' +
      OPT_OUT_TAG,
  },
  cancellation_fill_offer: {
    category: 'cancellation_fill_offer',
    body:
      'Hi {{first_name}} — {{practice_name}} has an opening with {{therapist_name}} on {{appt_time_local}}. Reply YES to take it (first to reply wins). ' +
      OPT_OUT_TAG,
  },
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Render a template by category. Substitutes every `{{var}}` token in
 * the body with the matching key from `vars`; missing/null values
 * collapse to the empty string (verified by tests, NOT left as
 * "{{first_name}}" in the outbound body).
 *
 * Throws if the rendered body exceeds MAX_BODY_CHARS so a runaway
 * substitution can't blow past the two-segment cap silently.
 */
export function renderSmsTemplate(
  category: SmsTemplateCategory,
  vars: SmsTemplateVars,
): string {
  const tpl = TEMPLATES[category]
  if (!tpl) {
    throw new Error(`unknown SMS template category: ${category}`)
  }
  const rendered = tpl.body.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const v = vars[key]
    if (v === null || v === undefined) return ''
    return String(v)
  })
  // Collapse any double-spaces left by empty substitutions.
  const tidy = rendered.replace(/\s{2,}/g, ' ').trim()
  if (tidy.length > MAX_BODY_CHARS) {
    throw new Error(
      `rendered SMS template '${category}' is ${tidy.length} chars (max ${MAX_BODY_CHARS})`,
    )
  }
  return tidy
}

/**
 * Static lookup of the template body (no substitution). Used by the
 * settings page's "preview your reminders" widget so a practice owner
 * can see the literal copy before opting in.
 */
export function getSmsTemplateBody(category: SmsTemplateCategory): string {
  return TEMPLATES[category].body
}

/**
 * Enumerate every category. Used by the settings UI to render one row
 * per template, and by ops smoke tests that want to assert no template
 * exceeds the length cap.
 */
export function listSmsTemplateCategories(): SmsTemplateCategory[] {
  return Object.keys(TEMPLATES) as SmsTemplateCategory[]
}

/**
 * Constant for the opt-out tag — re-exported so the inbound HELP handler
 * can echo the same string. Keeps copy in lockstep.
 */
export const SMS_OPT_OUT_TAG = OPT_OUT_TAG
