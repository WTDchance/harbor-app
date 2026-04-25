import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireApiSession } from '@/lib/aws/api-auth'

// GET /api/admin/signups
// Returns the last 100 practices with signup/provisioning status plus the
// global signups_enabled flag. Admin-only.
export async function GET(_request: NextRequest) {
  try {
    const supabase = await createClient()
    const __ctx = await requireApiSession();
  if (__ctx instanceof NextResponse) return __ctx;
  const user = { id: __ctx.user.id, email: __ctx.session.email };
  if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminEmail = process.env.ADMIN_EMAIL
    if (!adminEmail || user.email !== adminEmail) {
      return NextResponse.json({ error: 'Forbidden — admin only' }, { status: 403 })
    }

    // Pull recent practices
    const { data: practices, error: listError } = await supabaseAdmin
      .from('practices')
      .select(
        'id, name, therapist_name, notification_email, phone_number, ' +
          'status, subscription_status, founding_member, vapi_assistant_id, ' +
          'vapi_phone_number_id, twilio_phone_sid, stripe_customer_id, ' +
          'stripe_subscription_id, provisioning_error, provisioning_attempts, ' +
          'provisioned_at, created_at, specialties, telehealth'
      )
      .order('created_at', { ascending: false })
      .limit(100)

    if (listError) {
      console.error('[admin/signups] list error:', listError)
      return NextResponse.json({ error: 'Failed to load practices' }, { status: 500 })
    }

    // Kill switch state
    const { data: setting } = await supabaseAdmin
      .from('app_settings')
      .select('value, updated_at')
      .eq('key', 'signups_enabled')
      .maybeSingle()

    const signupsEnabled = setting?.value === true || setting?.value === 'true' || setting === null

    // Aggregate counters
    const total = practices?.length || 0
    const active = practices?.filter((p) => p.status === 'active').length || 0
    const pending = practices?.filter((p) => p.status === 'pending_payment').length || 0
    const failed =
      practices?.filter((p) => p.status === 'provisioning_failed' || !!p.provisioning_error)
        .length || 0
    const founding = practices?.filter((p) => p.founding_member === true).length || 0

    return NextResponse.json({
      signups_enabled: signupsEnabled,
      signups_toggled_at: setting?.updated_at ?? null,
      counts: { total, active, pending, failed, founding },
      practices: practices || [],
    })
  } catch (err) {
    console.error('[admin/signups] unhandled error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
