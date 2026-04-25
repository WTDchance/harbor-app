// /login — universal entry. Clean 307 to /login/aws (Cognito Hosted UI).

import { NextResponse, type NextRequest } from 'next/server'
import { absoluteUrl } from '@/lib/aws/url'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const params = new URLSearchParams()
  const next = req.nextUrl.searchParams.get('next')
  const error = req.nextUrl.searchParams.get('error')
  if (next && next.startsWith('/')) params.set('next', next)
  if (error) params.set('error', error)
  const qs = params.toString()
  return NextResponse.redirect(absoluteUrl(req, `/login/aws${qs ? `?${qs}` : ''}`))
}
