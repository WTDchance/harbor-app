// Admin-only — recent practices with signup/provisioning status + the
// global signups_enabled kill switch + aggregate counters.

import { NextResponse } from 'next/server'
import { requireAdminSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const ctx = await requireAdminSession()
  if (ctx instanceof NextResponse) return ctx

  // Columns aligned to the AWS canonical practices schema. The legacy
  // dashboard expects status/subscription_status/provisioning_error fields
  // that don't exist on AWS — synthesize them from provisioning_state.
  const { rows: rawPractices } = await pool.query(
    `SELECT id, name, owner_email, phone,
            provisioning_state, founding_member,
            vapi_assistant_id, vapi_phone_number_id, twilio_phone_sid,
            stripe_customer_id, stripe_subscription_id,
            specialties, created_at
       FROM practices
      ORDER BY created_at DESC
      LIMIT 100`,
  )

  // Map AWS schema → dashboard-expected shape (backwards compat).
  const practices = rawPractices.map((p) => ({
    id: p.id,
    name: p.name,
    therapist_name: null,
    notification_email: p.owner_email,
    phone_number: p.phone,
    status: p.provisioning_state,
    subscription_status: p.stripe_subscription_id ? 'active' : null,
    founding_member: p.founding_member,
    vapi_assistant_id: p.vapi_assistant_id,
    vapi_phone_number_id: p.vapi_phone_number_id,
    twilio_phone_sid: p.twilio_phone_sid,
    stripe_customer_id: p.stripe_customer_id,
    provisioning_error:
      p.provisioning_state === 'provisioning_failed' ? 'See ECS logs for details' : null,
    provisioning_attempts: null,
    provisioned_at: p.provisioning_state === 'active' ? p.created_at : null,
    created_at: p.created_at,
  }))

  // Kill-switch state. Default-enabled when the row is missing.
  let signupsEnabled = true
  let signupsToggledAt: string | null = null
  try {
    const { rows } = await pool.query(
      `SELECT value, updated_at FROM app_settings WHERE key = 'signups_enabled' LIMIT 1`,
    )
    const v = rows[0]?.value
    if (v === false || v === 'false') signupsEnabled = false
    signupsToggledAt = rows[0]?.updated_at ?? null
  } catch {
    // app_settings may not exist on this RDS — fall through to default.
  }

  // Aggregate counters
  const total = practices.length
  const active = practices.filter((p) => p.status === 'active').length
  const pending = practices.filter((p) => p.status === 'pending_payment').length
  const failed = practices.filter((p) => p.status === 'provisioning_failed').length
  const founding = practices.filter((p) => p.founding_member === true).length
  const aggregates = { total, active, pending, failed, founding }

  return NextResponse.json({
    practices,
    // Provide both names for backwards compat with the legacy dashboard.
    counts: aggregates,
    counters: aggregates,
    signups_enabled: signupsEnabled,
    signups_toggled_at: signupsToggledAt,
  })
}
