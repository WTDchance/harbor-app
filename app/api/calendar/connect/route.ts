import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase'
import { NextRequest, NextResponse } from 'next/server'

async function getPracticeId(): Promise<string | null> {
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
  const { data } = await supabaseAdmin.from('users').select('practice_id').eq('id', user.id).single()
  return data?.practice_id || null
}

/**
 * Validate CalDAV credentials by attempting a PROPFIND on iCloud.
 * Returns calendar count on success, throws on failure.
 */
async function validateCalDAV(email: string, password: string): Promise<{ calendarCount: number }> {
  const caldavUrl = 'https://caldav.icloud.com'
  const principalUrl = `${caldavUrl}/${encodeURIComponent(email)}/calendars/`

  // PROPFIND to discover calendars
  const res = await fetch(principalUrl, {
    method: 'PROPFIND',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(`${email}:${password}`).toString('base64'),
      'Content-Type': 'application/xml; charset=utf-8',
      'Depth': '1',
    },
    body: `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:cs="http://calendarserver.org/ns/" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:displayname/>
    <d:resourcetype/>
    <cs:getctag/>
  </d:prop>
</d:propfind>`,
  })

  if (res.status === 401 || res.status === 403) {
    throw new Error('Invalid credentials. Make sure you are using an app-specific password, not your Apple ID password.')
  }

  if (!res.ok && res.status !== 207) {
    throw new Error(`CalDAV server returned status ${res.status}. Please try again.`)
  }

  // Parse the 207 multistatus response to count calendars
  const xml = await res.text()
  // Count <d:resourcetype> entries that contain <c:calendar/> or <cal:calendar/>
  const calendarMatches = xml.match(/<[^>]*calendar[^/]*\/>/gi) || []
  const calendarCount = Math.max(calendarMatches.length, 1) // at least 1 if we got 207

  return { calendarCount }
}

// GET — return Apple Calendar connection status for the settings page
export async function GET(req: NextRequest) {
  try {
    const practiceId = await getPracticeId()
    if (!practiceId) {
      return NextResponse.json({ connected: false, username: null })
    }

    const { data, error } = await supabaseAdmin
      .from('calendar_connections')
      .select('*')
      .eq('practice_id', practiceId)
      .eq('provider', 'apple')
      .maybeSingle()

    if (error) {
      console.error('[calendar/connect GET]', error)
      return NextResponse.json({ connected: false, username: null })
    }

    if (!data) {
      return NextResponse.json({ connected: false, username: null })
    }

    return NextResponse.json({
      connected: true,
      username: data.connected_email || data.caldav_username,
      calendarCount: data.calendar_count || null,
    })
  } catch (err) {
    console.error('[calendar/connect GET]', err)
    return NextResponse.json({ connected: false, username: null })
  }
}

interface ConnectRequestBody {
  provider: 'apple' | 'google' | 'outlook'
  email?: string
  password?: string
  name?: string
  caldav_url?: string
}

// POST — connect Apple Calendar with CalDAV validation
export async function POST(req: NextRequest) {
  try {
    const practiceId = await getPracticeId()
    if (!practiceId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body: ConnectRequestBody = await req.json()
    const { provider, email, password, name, caldav_url } = body

    if (!provider) {
      return NextResponse.json({ error: 'provider is required' }, { status: 400 })
    }

    if (provider === 'apple') {
      if (!email || !password) {
        return NextResponse.json(
          { error: 'Apple ID email and app-specific password are required.' },
          { status: 400 }
        )
      }

      // Validate credentials against iCloud CalDAV
      let calendarCount = 0
      try {
        const result = await validateCalDAV(email, password)
        calendarCount = result.calendarCount
      } catch (err: any) {
        return NextResponse.json(
          { error: err.message || 'Failed to connect to iCloud calendar.' },
          { status: 400 }
        )
      }

      const connectionData = {
        practice_id: practiceId,
        provider: 'apple',
        label: name || `Apple Calendar (${email})`,
        caldav_username: email,
        caldav_password: password,
        caldav_url: caldav_url || 'https://caldav.icloud.com',
        connected_email: email,
        calendar_count: calendarCount,
        sync_enabled: true,
        updated_at: new Date().toISOString()
      }

      const { data, error } = await supabaseAdmin
        .from('calendar_connections')
        .upsert(
          {
            ...connectionData,
            created_at: new Date().toISOString()
          },
          { onConflict: 'practice_id,provider' }
        )
        .select()
        .single()

      if (error) {
        console.error('[calendar/connect POST] DB error:', error)
        return NextResponse.json({ error: 'Failed to save connection. ' + error.message }, { status: 500 })
      }

      return NextResponse.json({
        connected: true,
        username: email,
        calendarCount,
      }, { status: 201 })
    }

    return NextResponse.json(
      { error: `Provider ${provider} not supported in this endpoint` },
      { status: 400 }
    )
  } catch (err) {
    console.error('[calendar/connect POST]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

interface DeleteRequestBody {
  provider: 'apple' | 'google' | 'outlook'
}

// DELETE — disconnect a calendar provider
export async function DELETE(req: NextRequest) {
  try {
    const practiceId = await getPracticeId()
    if (!practiceId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body: DeleteRequestBody = await req.json()
    const { provider } = body

    if (!provider) {
      return NextResponse.json({ error: 'provider is required' }, { status: 400 })
    }

    const { error } = await supabaseAdmin
      .from('calendar_connections')
      .delete()
      .eq('practice_id', practiceId)
      .eq('provider', provider)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[calendar/connect DELETE]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
