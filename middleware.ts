// Harbor — Cognito-only auth middleware.
//
// Public allowlist (no auth required): / , /login, /login/aws, /signup, /onboard,
//   /intake, /privacy*, /terms, /sms, /reset-password, /appointments/*,
//   plus Next internals and select /api/* (each route enforces its own auth).
//
// Everything else requires a valid Cognito ID token cookie (presence checked at
// the edge; full JWKS verification happens in route handlers via getServerSession()).

import { NextResponse, type NextRequest } from 'next/server'

const HARBOR_ID_COOKIE = 'harbor_id'

const PUBLIC_PREFIXES = [
  '/login',
  '/signup',
  '/onboard',
  '/intake',
  '/privacy',
  '/privacy-policy',
  '/terms',
  '/sms',
  '/reset-password',
  '/appointments/',
  '/_next',
  '/favicon',
]

const PUBLIC_EXACT = new Set(['/'])

const PUBLIC_API_PREFIXES = [
  '/api/health',
  '/api/auth/',
  '/api/cron/',
  '/api/admin/',
  '/api/stripe/webhook',
  '/api/ehr/billing/stripe-webhook',
  '/api/vapi/webhook',          // legacy carrier — kept for inbound webhook compat
  '/api/sms/',
  '/api/signup',
  '/api/audit-log',
  // Wave 27 carrier-swap public webhook paths. SignalWire signs each
  // inbound POST with x-signalwire-signature; Retell signs lifecycle
  // events with x-retell-signature. Those signatures are verified at
  // route level — middleware can't see them since it runs before route
  // handlers. /api/voice/tools/* is gated by RETELL_AGENT_ID match
  // inside parseRetellToolCall (Wave 27c).
  '/api/signalwire/',
  '/api/retell/',
  '/api/voice/',
  '/api/twilio/',
  '/api/stedi/',                // Wave 41 — Stedi 835 ERA + 837 claim webhooks
  '/api/schedule/',             // Wave 42 — public new-patient inquiry                // Wave 41 — Stedi 835 ERA + 837 claim webhooks
                                // (HMAC verified at route level)               // deprecation stubs — keep public so
                                // stale Twilio dashboards see the
                                // 'this number has moved' TwiML.
]

function isPublic(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true
  if (PUBLIC_PREFIXES.some(p => pathname.startsWith(p))) return true
  if (pathname.startsWith('/api/')) {
    return PUBLIC_API_PREFIXES.some(p => pathname.startsWith(p))
  }
  return false
}

// Resolve the request's PUBLIC origin (host + scheme), preferring forwarded
// headers over request.nextUrl. Behind the ALB, nextUrl reports the container
// bind address (localhost:3000) which would produce broken redirects.
function publicOriginFromRequest(req: NextRequest): string {
  const headers = req.headers
  const fwdHost = headers.get('x-forwarded-host')
  const fwdProto = headers.get('x-forwarded-proto')
  const host = headers.get('host')
  const internal = (h: string | null) =>
    !h || h.startsWith('localhost') || h.startsWith('127.') || h.startsWith('0.0.0.0')
  if (!internal(fwdHost)) return `${fwdProto || 'https'}://${fwdHost}`
  if (!internal(host)) return `${fwdProto || 'https'}://${host}`
  // last-resort fallback so we never emit localhost in prod redirects
  return 'https://lab.harboroffice.ai'
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (isPublic(pathname)) {
    return NextResponse.next({ request })
  }

  const idToken = request.cookies.get(HARBOR_ID_COOKIE)?.value
  if (!idToken) {
    const origin = publicOriginFromRequest(request)
    const target = new URL(`${origin}/login/aws`)
    target.searchParams.set('next', pathname)
    return NextResponse.redirect(target)
  }
  return NextResponse.next({ request })
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
