/**
 * GET /api/calendar/ics-token   — return the practice's ICS feed URL for the current session user
 * POST /api/calendar/ics-token  — regenerate the token (revoking any existing subscribers)
 *
 * Session-authenticated via the browser Supabase client (cookie-based).
 * Always scopes to the caller's practice_id — no cross-practice lookup.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { createClient } from '@/lib/supabase-server'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'

async function resolvePracticeId(): Promise<string | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  // Use admin for the users lookup — avoids RLS surprises on the actAs path.
  const { data } = await supabaseAdmin
    .from('users')
    .select('practice_id')
    .eq('id', user.id)
    .maybeSingle()
  return data?.practice_id ?? null
}

function buildFeedUrl(token: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || 'https://harborreceptionist.com'
  // webcal:// triggers native "subscribe to calendar" in Apple/Google/Outlook
  // — we surface both the webcal:// and https:// variants to the user.
  const httpsUrl = `${base.replace(/\/$/, '')}/api/calendar/ics/${token}`
  const webcalUrl = httpsUrl.replace(/^https?:\/\//, 'webcal://')
  return JSON.stringify({ https: httpsUrl, webcal: webcalUrl })
}

export async function GET(_req: NextRequest) {
  const practiceId = await resolvePracticeId()
  if (!practiceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: practice, error } = await supabaseAdmin
    .from('practices')
    .select('ics_feed_token, ics_feed_revoked_at')
    .eq('id', practiceId)
    .single()

  if (error || !practice) {
    return NextResponse.json({ error: 'Practice not found' }, { status: 404 })
  }

  if (!practice.ics_feed_token) {
    // Lazy-create a token on first access
    const token = crypto.randomBytes(24).toString('base64url')
    await supabaseAdmin
      .from('practices')
      .update({ ics_feed_token: token, ics_feed_revoked_at: null })
      .eq('id', practiceId)
    practice.ics_feed_token = token
  }

  const base = process.env.NEXT_PUBLIC_APP_URL || 'https://harborreceptionist.com'
  const httpsUrl = `${base.replace(/\/$/, '')}/api/calendar/ics/${practice.ics_feed_token}`
  const webcalUrl = httpsUrl.replace(/^https?:\/\//, 'webcal://')

  return NextResponse.json({
    https_url: httpsUrl,
    webcal_url: webcalUrl,
    revoked: !!practice.ics_feed_revoked_at,
  })
}

export async function POST(_req: NextRequest) {
  const practiceId = await resolvePracticeId()
  if (!practiceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const newToken = crypto.randomBytes(24).toString('base64url')
  const { error } = await supabaseAdmin
    .from('practices')
    .update({ ics_feed_token: newToken, ics_feed_revoked_at: null })
    .eq('id', practiceId)

  if (error) {
    return NextResponse.json({ error: 'Failed to regenerate' }, { status: 500 })
  }

  const base = process.env.NEXT_PUBLIC_APP_URL || 'https://harborreceptionist.com'
  const httpsUrl = `${base.replace(/\/$/, '')}/api/calendar/ics/${newToken}`
  const webcalUrl = httpsUrl.replace(/^https?:\/\//, 'webcal://')

  return NextResponse.json({ https_url: httpsUrl, webcal_url: webcalUrl, revoked: false })
}
