// AWS-side login: route handler that 307-redirects into Cognito Hosted UI.
//
// Implemented as a route handler (not a page) so we get a clean external
// redirect with a real Location header. Server-component redirect() to an
// external URL would emit an HTML page with meta-refresh — bad UX.

import { NextResponse, type NextRequest } from 'next/server'
import { loginUrl } from '@/lib/aws/cognito'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const next = req.nextUrl.searchParams.get('next')
  const target = next && next.startsWith('/') ? next : '/dashboard/aws'
  // Pass `next` through Cognito's `state` so the callback lands us back where
  // we tried to go.
  return NextResponse.redirect(loginUrl(target))
}
