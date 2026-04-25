// Harbor — Cognito-only auth middleware.
//
// Public allowlist (no auth required): / , /login, /login/aws, /signup, /onboard,
//   /intake, /privacy*, /terms, /sms, /reset-password, /appointments/*,
//   plus Next internals and most /api/* (each route enforces its own auth).
//
// Everything else requires a valid Cognito ID token cookie (presence checked at
// the edge; full JWKS verification happens in route handlers via getServerSession()).

import { NextResponse, type NextRequest } from 'next/server'

const HARBOR_ID_COOKIE = 'harbor_id'

const PUBLIC_PREFIXES = [
  '/login',           // /login + /login/aws
  '/signup',
  '/onboard',
  '/intake',
  '/privacy',
  '/privacy-policy',
  '/terms',
  '/sms',
  '/reset-password',
  '/appointments/',   // public confirm/cancel pages keyed by appointment UUID
  '/_next',
  '/favicon',
]

const PUBLIC_EXACT = new Set(['/'])

// API routes that must remain public (or auth themselves internally).
// Everything else under /api requires a Cognito session.
const PUBLIC_API_PREFIXES = [
  '/api/health',
  '/api/auth/',           // /api/auth/callback, /api/auth/logout
  '/api/cron/',           // gated by Bearer CRON_SECRET in route handler
  '/api/admin/',          // gated by Bearer CRON_SECRET in route handler
  '/api/stripe/webhook',  // Stripe signature
  '/api/vapi/webhook',    // Vapi shared secret
  '/api/sms/',            // Twilio webhooks
  '/api/signup',          // self-service signup
  '/api/audit-log',       // gated internally
]

function isPublic(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true
  if (PUBLIC_PREFIXES.some(p => pathname.startsWith(p))) return true
  if (pathname.startsWith('/api/')) {
    return PUBLIC_API_PREFIXES.some(p => pathname.startsWith(p))
  }
  return false
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (isPublic(pathname)) {
    return NextResponse.next({ request })
  }

  const idToken = request.cookies.get(HARBOR_ID_COOKIE)?.value
  if (!idToken) {
    // Not signed in. Send through /login/aws which redirects to Cognito Hosted UI.
    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = '/login/aws'
    loginUrl.searchParams.set('next', pathname)
    return NextResponse.redirect(loginUrl)
  }
  return NextResponse.next({ request })
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
