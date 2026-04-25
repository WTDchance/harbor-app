// /login — universal entry. Clean 307 to /login/aws (Cognito Hosted UI).
//
// route.ts (not page.tsx) gives a real Location header instead of an
// HTML 200 with <meta http-equiv=refresh>.

import { NextResponse, type NextRequest } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const u = req.nextUrl
  const params = new URLSearchParams()
  const next = u.searchParams.get('next')
  const error = u.searchParams.get('error')
  if (next && next.startsWith('/')) params.set('next', next)
  if (error) params.set('error', error)
  const qs = params.toString()
  return NextResponse.redirect(new URL(`/login/aws${qs ? `?${qs}` : ''}`, u))
}
