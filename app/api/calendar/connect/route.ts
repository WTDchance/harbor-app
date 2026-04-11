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

export async function GET(req: NextRequest) {
  try {
    const practiceId = await getPracticeId()
    if (!practiceId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data, error } = await supabaseAdmin
      .from('calendar_connections')
      .select('*')
      .eq('practice_id', practiceId)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ connections: data })
  } catch (err) {
    console.error('[calendar/connect GET]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

interface ConnectRequestBody {
  provider: 'apple' | 'google' | 'outlook'
  email?: string
  password?: string
  name?: string
  caldav_url?: string
}

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
          { error: 'email and password required for Apple CalDAV' },
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
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      return NextResponse.json({ connection: data }, { status: 201 })
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
