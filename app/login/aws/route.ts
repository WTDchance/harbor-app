// app/login/aws/route.ts — legacy fallback redirect.
// Wave 32 made /login a real custom page. Anyone hitting /login/aws
// (old links, bookmarks) lands on /login with the next param preserved.

import { NextResponse, type NextRequest } from 'next/server'
import { absoluteUrl } from '@/lib/aws/url'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const next = req.nextUrl.searchParams.get('next')
  const error = req.nextUrl.searchParams.get('error')
  const params = new URLSearchParams()
  if (next && next.startsWith('/')) params.set('next', next)
  if (error) params.set('error', error)
  const qs = params.toString()
  return NextResponse.redirect(absoluteUrl(req, `/login${qs ? `?${qs}` : ''}`))
}
