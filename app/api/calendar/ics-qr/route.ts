/**
 * GET /api/calendar/ics-qr
 *
 * Returns an SVG QR code of the authenticated practice's webcal:// subscription
 * URL. Scanning it on a phone opens the native calendar "subscribe" prompt.
 *
 * Auth: session-based via the browser Supabase client. Scopes to the caller's
 * practice_id. The QR is rendered on demand at request time so regenerating
 * the token produces a new QR without requiring a separate redraw step.
 */
import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { createClient } from '@/lib/supabase-server'
import QRCode from 'qrcode'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

async function resolvePracticeId(): Promise<string | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabaseAdmin
    .from('users')
    .select('practice_id')
    .eq('id', user.id)
    .maybeSingle()
  return data?.practice_id ?? null
}

export async function GET(_req: NextRequest) {
  const practiceId = await resolvePracticeId()
  if (!practiceId) {
    return new Response('Unauthorized', { status: 401 })
  }

  const { data: practice, error } = await supabaseAdmin
    .from('practices')
    .select('ics_feed_token, ics_feed_revoked_at')
    .eq('id', practiceId)
    .single()

  if (error || !practice || !practice.ics_feed_token || practice.ics_feed_revoked_at) {
    return new Response('Feed not available', { status: 404 })
  }

  const base = process.env.NEXT_PUBLIC_APP_URL || 'https://harborreceptionist.com'
  const webcalUrl = `${base.replace(/\/$/, '').replace(/^https?:\/\//, 'webcal://')}/api/calendar/ics/${practice.ics_feed_token}`

  const svg = await QRCode.toString(webcalUrl, {
    type: 'svg',
    margin: 2,
    errorCorrectionLevel: 'M',
    color: { dark: '#0f172a', light: '#ffffff' },
    width: 240,
  })

  return new Response(svg, {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'private, no-store',
    },
  })
}
