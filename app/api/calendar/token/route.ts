import { supabaseAdmin } from '@/lib/supabase'
import { NextRequest, NextResponse } from 'next/server'
import { resolvePracticeIdForApi } from '@/lib/active-practice'
import { requireApiSession } from '@/lib/aws/api-auth'

async function getPracticeId(): Promise<string | null> {
  // supabase client removed (Cognito auth)
  const __ctx = await requireApiSession();
  if (__ctx instanceof NextResponse) return __ctx;
  const user = { id: __ctx.user.id, email: __ctx.session.email };
  if (!user) return null
  return resolvePracticeIdForApi(supabaseAdmin, user)
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
