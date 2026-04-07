// GET /api/signup/status?session_id=cs_test_...
// Used by the /signup/success page to poll for provisioning completion after
// Stripe Checkout redirects the user back. Returns the practice's current
// status and (when ready) the provisioned Harbor phone number.

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get('session_id')
  if (!sessionId) {
    return NextResponse.json({ error: 'Missing session_id' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('practices')
    .select('id, name, ai_name, status, subscription_status, phone_number, founding_member, provisioned_at')
    .eq('stripe_checkout_session_id', sessionId)
    .maybeSingle()

  if (error) {
    console.error('signup/status query failed:', error)
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 })
  }

  if (!data) {
    // Webhook may not have reached us yet (or user arrived here before
    // Stripe fired the event). Return pending so the client keeps polling.
    return NextResponse.json({ status: 'pending', provisioning: true })
  }

  const ready =
    data.status === 'active' &&
    !!data.phone_number &&
    !!data.provisioned_at

  return NextResponse.json({
    status: data.status,
    subscription_status: data.subscription_status,
    provisioning: !ready,
    ready,
    practice_id: data.id,
    practice_name: data.name,
    ai_name: data.ai_name,
    phone_number: data.phone_number,
    founding_member: data.founding_member,
  })
}
