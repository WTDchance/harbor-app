// AWS-side login: route handler that 307-redirects into Cognito Hosted UI.

import { NextResponse, type NextRequest } from 'next/server'
import { loginUrl } from '@/lib/aws/cognito'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const next = req.nextUrl.searchParams.get('next')
  const target = next && next.startsWith('/') ? next : '/dashboard/aws'
  // loginUrl() builds a full https://harbor-staging-auth.auth... URL — this
  // doesn't depend on req.url and isn't affected by the localhost issue.
  return NextResponse.redirect(loginUrl(target))
}
