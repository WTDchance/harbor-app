import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireApiSession } from '@/lib/aws/api-auth'

/**
 * POST /api/notifications/subscribe
 * Save a browser push subscription for this practice
 */
export async function POST(req: NextRequest) {
  try {
    // supabase client removed (Cognito auth)
  const __ctx = await requireApiSession();
  if (__ctx instanceof NextResponse) return __ctx;
  const user = { id: __ctx.user.id, email: __ctx.session.email };
  if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: practice } = await supabase
      .from('practices')
      .select('id')
      .eq('notification_email', user.email)
      .single()

    if (!practice) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const { subscription, user_agent } = await req.json()

    await supabaseAdmin.from('push_subscriptions').insert({
      practice_id: practice.id,
      subscription,
      user_agent,
    })

    return NextResponse.json({ ok: true })
  } catch (error: any) {
    console.error('Error subscribing to push notifications:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * GET /api/notifications/subscribe
 * Return all push subscriptions for this practice
 */
export async function GET(req: NextRequest) {
  try {
    // supabase client removed (Cognito auth)
  const __ctx = await requireApiSession();
  if (__ctx instanceof NextResponse) return __ctx;
  const user = { id: __ctx.user.id, email: __ctx.session.email };
  if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: practice } = await supabase
      .from('practices')
      .select('id')
      .eq('notification_email', user.email)
      .single()

    if (!practice) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const { data: subscriptions } = await supabaseAdmin
      .from('push_subscriptions')
      .select('*')
      .eq('practice_id', practice.id)

    return NextResponse.json({ subscriptions: subscriptions || [] })
  } catch (error: any) {
    console.error('Error fetching push subscriptions:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
