// SVG QR code of the practice's webcal:// subscribe URL. Scanning on a
// phone opens the native calendar "subscribe to calendar" prompt.
//
// Auth: standard Cognito session. Rendered on demand so a token rotation
// produces a new QR on next render with no separate redraw step.
//
// Token system unified around calendar_token (same as /api/calendar/feed).

import { NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import QRCode from 'qrcode'
import { requireApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function publicAppUrl(): string {
  return (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || '')
    .replace(/\/$/, '')
}

export async function GET() {
  const ctx = await requireApiSession()
  if (ctx instanceof NextResponse) return ctx
  if (!ctx.practiceId) return new NextResponse('Unauthorized', { status: 401 })

  const lookup = await pool.query(
    `SELECT calendar_token FROM practices WHERE id = $1 LIMIT 1`,
    [ctx.practiceId],
  )
  let token: string | null = lookup.rows[0]?.calendar_token ?? null

  if (!token) {
    token = randomBytes(24).toString('base64url')
    await pool.query(
      `UPDATE practices SET calendar_token = $1 WHERE id = $2`,
      [token, ctx.practiceId],
    ).catch(err => console.error('[ics-qr] lazy-create failed', err))
  }

  const base = publicAppUrl()
  const webcalUrl = `${base.replace(/^https?:\/\//, 'webcal://')}/api/calendar/feed?token=${token}`

  const svg = await QRCode.toString(webcalUrl, {
    type: 'svg',
    margin: 2,
    errorCorrectionLevel: 'M',
    color: { dark: '#0f172a', light: '#ffffff' },
    width: 240,
  })

  return new NextResponse(svg, {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'private, no-store',
    },
  })
}
