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
  // route's status/subscription_status/provisioning_error columns aren't
  // on the AWS schema; the dashboard derives equivalents from
  // provisioning_state instead.
  const { rows: practices } = await pool.query(
    `SELECT id, name, owner_email, phone,
            provisioning_state, founding_member,
            vapi_assistant_id, vapi_phone_number_id, twilio_phone_sid,
            stripe_customer_id, stripe_subscription_id,
            specialties, created_at
       FROM practices
      ORDER BY created_at DESC
      LIMIT 100`,
  )

  // Kill-switch state. Default-enabled when the row is missing.
  let signupsEnabled = true
  try {
    const { rows } = await pool.query(
      `SELECT value, updated_at FROM app_settings WHERE key = 'signups_enabled' LIMIT 1`,
    )
    const v = rows[0]?.value
    if (v === false || v === 'false') signupsEnabled = false
  } catch {
    // app_settings may not exist on this RDS — fall through to default.
  }

  // Aggregate counters
  const total = practices.length
  const active = practices.filter(p => p.provisioning_state === 'active').length
  const pending = practices.filter(p => p.provisioning_state === 'pending_payment').length
  const failed = practices.filter(p => p.provisioning_state === 'provisioning_failed').length
  const founding = practices.filter(p => p.founding_member === true).length

  return NextResponse.json({
    practices,
    counters: { total, active, pending, failed, founding },
    signups_enabled: signupsEnabled,
  })
}
