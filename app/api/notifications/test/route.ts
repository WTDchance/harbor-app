import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

/**
 * POST /api/notifications/test
 * Send a test notification to the configured channel
 * Body: { type: 'slack' | 'smart_light' | 'push', message: string }
 */
export async function POST(req: NextRequest) {
  try {
    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll()
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              )
            } catch {
              // Middleware will handle this
            }
          },
        },
      }
    )

    const { data: { user } } = await supabase.auth.getUser()
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

    const { type, message } = await req.json()

    if (!type || !message) {
      return NextResponse.json(
        { error: 'Missing type or message' },
        { status: 400 }
      )
    }

    const prefs = practice.notification_prefs || {}
    const timestamp = new Date().toISOString()
    const results: any[] = []

    if (type === 'slack') {
      if (!prefs.slack_webhook_url) {
        return NextResponse.json(
          { error: 'Slack webhook URL not configured' },
          { status: 400 }
        )
      }

      try {
        const response = await fetch(prefs.slack_webhook_url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: `🧪 Test Notification\n${message}\n_Sent at ${timestamp}_`,
          }),
        })

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }

        results.push({
          channel: 'slack',
          status: 'sent',
          message: 'Test message sent to Slack',
        })
      } catch (error: any) {
        results.push({
          channel: 'slack',
          status: 'error',
          error: error.message,
        })
      }
    }

    if (type === 'smart_light') {
      if (!prefs.smart_light_webhook_url) {
        return NextResponse.json(
          { error: 'Smart Light webhook URL not configured' },
          { status: 400 }
        )
      }

      try {
        const response = await fetch(prefs.smart_light_webhook_url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: `🧪 Test Notification\n${message}`,
            type: 'test',
            timestamp,
            practice_id: practice.id,
          }),
        })

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }

        results.push({
          channel: 'smart_light',
          status: 'sent',
          message: 'Test message sent to Smart Light',
        })
      } catch (error: any) {
        results.push({
          channel: 'smart_light',
          status: 'error',
          error: error.message,
        })
      }
    }

    if (type === 'push') {
      try {
        const { data: subscriptions } = await supabaseAdmin
          .from('push_subscriptions')
          .select('subscription')
          .eq('practice_id', practice.id)

        if (!subscriptions || subscriptions.length === 0) {
          return NextResponse.json(
            { error: 'No push subscriptions found. Push notifications not set up.' },
            { status: 400 }
          )
        }

        // For now, log the intent
        results.push({
          channel: 'push',
          status: 'pending',
          message: `Test push notification would be sent to ${subscriptions.length} device(s). Web-push integration coming soon.`,
        })
      } catch (error: any) {
        results.push({
          channel: 'push',
          status: 'error',
          error: error.message,
        })
      }
    }

    return NextResponse.json({ results })
  } catch (error: any) {
    console.error('Error sending test notification:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
