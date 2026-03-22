import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

async function getPractice() {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (s) => {
          try { s.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) } catch {}
        }
      }
    }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase.from('practices').select('id').eq('notification_email', user.email).single()
  return data
}

export async function POST(req: NextRequest) {
  try {
    const practice = await getPractice()
    if (!practice) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { provider, email, password, name } = await req.json()

    if (!provider || !email) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // For Apple CalDAV: test credentials before saving
    if (provider === 'apple' && password) {
      try {
        const testResp = await fetch('https://caldav.icloud.com/', {
          method: 'OPTIONS',
          headers: {
            Authorization: 'Basic ' + Buffer.from(email + ':' + password).toString('base64'),
          },
          signal: AbortSignal.timeout(6000),
        })
        if (testResp.status === 401) {
          return NextResponse.json({
            error: 'Apple ID authentication failed. Make sure you are using an app-specific password from appleid.apple.com, not your main Apple ID password.',
          }, { status: 400 })
        }
      } catch {
        // Network error or timeout — save anyway and retry on first sync
      }
    }

    const label =
      name ||
      (provider === 'apple' ? 'Apple Calendar' :
       provider === 'google' ? 'Google Calendar' : 'Outlook Calendar')

    const { error } = await supabaseAdmin
      .from('calendar_connections')
      .upsert({
        practice_id: practice.id,
        provider,
        label,
        caldav_username: provider === 'apple' ? email : null,
        caldav_password: provider === 'apple' ? password : null,
        sync_enabled: true,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'practice_id,provider',
      })

    if (error) {
      console.error('calendar_connections upsert error:', error)
      if (error.code === '42P01') {
        return NextResponse.json({
          error: 'Calendar connections table not set up yet. Please contact support.',
        }, { status: 500 })
      }
      throw error
    }

    return NextResponse.json({ success: true })
  } catch (e: any) {
    console.error('Calendar connect error:', e)
    return NextResponse.json({ error: e.message || 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const practice = await getPractice()
    if (!practice) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { provider } = await req.json()
    await supabaseAdmin
      .from('calendar_connections')
      .delete()
      .eq('practice_id', practice.id)
      .eq('provider', provider)

    return NextResponse.json({ success: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
