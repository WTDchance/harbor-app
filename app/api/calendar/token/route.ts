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

    const { data: practice, error } = await supabaseAdmin
      .from('practices')
      .select('calendar_token')
      .eq('id', practiceId)
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (!practice?.calendar_token) {
      return NextResponse.json({ token: null })
    }

    return NextResponse.json({
      token: practice.calendar_token,
      feedUrl: `${process.env.NEXT_PUBLIC_APP_URL}/api/calendar/feed?token=${practice.calendar_token}`
    })
  } catch (err) {
    console.error('[calendar/token GET]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const practiceId = await getPracticeId()
    if (!practiceId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const newToken = Array.from({ length: 32 }, () =>
      Math.floor(Math.random() * 16).toString(16)
    ).join('')

    const { error } = await supabaseAdmin
      .from('practices')
      .update({
        calendar_token: newToken,
        updated_at: new Date().toISOString()
      })
      .eq('id', practiceId)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({
      token: newToken,
      feedUrl: `${process.env.NEXT_PUBLIC_APP_URL}/api/calendar/feed?token=${newToken}`
    })
  } catch (err) {
    console.error('[calendar/token POST]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
