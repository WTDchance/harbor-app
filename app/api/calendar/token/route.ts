// MIGRATION REQUIRED: ALTER TABLE practices ADD COLUMN IF NOT EXISTS calendar_token TEXT UNIQUE;
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase'

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
        },
      },
    }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabaseAdmin
    .from('practices')
    .select('id')
    .eq('notification_email', user.email)
    .single()
  return data?.id ?? null
}

function buildFeedUrl(token: string): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://harborreceptionist.com'
  return `${appUrl}/api/calendar/feed?token=${token}`
}

// GET — return current token + feed URL
export async function GET() {
  const practiceId = await getPracticeId()
  if (!practiceId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data } = await supabaseAdmin
    .from('practices')
    .select('calendar_token')
    .eq('id', practiceId)
    .single()

  const token = data?.calendar_token ?? null
  return NextResponse.json({
    token,
    feedUrl: token ? buildFeedUrl(token) : null,
  })
}

// POST — generate token if not set
export async function POST() {
  const practiceId = await getPracticeId()
  if (!practiceId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: existing } = await supabaseAdmin
    .from('practices')
    .select('calendar_token')
    .eq('id', practiceId)
    .single()

  if (existing?.calendar_token) {
    return NextResponse.json({
      token: existing.calendar_token,
      feedUrl: buildFeedUrl(existing.calendar_token),
    })
  }

  const token = crypto.randomUUID()
  await supabaseAdmin
    .from('practices')
    .update({ calendar_token: token })
    .eq('id', practiceId)

  return NextResponse.json({ token, feedUrl: buildFeedUrl(token) })
}

// DELETE — regenerate token (invalidates old subscriptions)
export async function DELETE() {
  const practiceId = await getPracticeId()
  if (!practiceId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const token = crypto.randomUUID()
  await supabaseAdmin
    .from('practices')
    .update({ calendar_token: token })
    .eq('id', practiceId)

  return NextResponse.json({ token, feedUrl: buildFeedUrl(token) })
}
