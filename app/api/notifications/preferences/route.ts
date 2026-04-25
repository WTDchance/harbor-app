import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireApiSession } from '@/lib/aws/api-auth'

/**
 * GET /api/notifications/preferences
 * Return notification preferences for current practice
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
      .select('notification_prefs')
      .eq('notification_email', user.email)
      .single()

    if (!practice) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    return NextResponse.json({ preferences: practice.notification_prefs })
  } catch (error: any) {
    console.error('Error fetching notification preferences:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/notifications/preferences
 * Update notification preferences (deep merge with existing)
 */
export async function PATCH(req: NextRequest) {
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
      .select('id, notification_prefs')
      .eq('notification_email', user.email)
      .single()

    if (!practice) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const updates = await req.json()

    // Deep merge with existing preferences
    const currentPrefs = practice.notification_prefs || {}
    const mergedPrefs = {
      ...currentPrefs,
      ...updates,
      // Deep merge nested objects
      crisis: { ...currentPrefs.crisis, ...updates.crisis },
      arrival: { ...currentPrefs.arrival, ...updates.arrival },
    }

    const { error } = await supabaseAdmin
      .from('practices')
      .update({ notification_prefs: mergedPrefs })
      .eq('id', practice.id)

    if (error) {
      throw error
    }

    return NextResponse.json({ preferences: mergedPrefs })
  } catch (error: any) {
    console.error('Error updating notification preferences:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
