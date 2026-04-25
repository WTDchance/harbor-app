// Harbor auth middleware
// During path-B migration, two auth systems coexist:
//   - /dashboard/aws/*, /admin/aws/*, /api/aws/* → Cognito (HttpOnly harbor_id cookie)
//   - everything else → legacy Supabase auth
//
// Admin is determined by email matching ADMIN_EMAIL env var.

import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const ADMIN_EMAIL = process.env.ADMIN_EMAIL

// Edge-runtime-safe Cognito cookie name. Importing from lib/aws/cognito would
// pull aws-jwt-verify (Node-only) into the edge bundle, so we duplicate the
// constant here.
const HARBOR_ID_COOKIE = 'harbor_id'

function isAwsPath(pathname: string): boolean {
  return (
    pathname.startsWith('/dashboard/aws') ||
    pathname.startsWith('/admin/aws') ||
    pathname.startsWith('/api/aws')
  )
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // ── Cognito branch ────────────────────────────────────────────────────────
  // Edge runtime can't verify JWT signatures, so we only check presence here.
  // Server components and API routes call getServerSession() which does the
  // full JWKS verification.
  if (isAwsPath(pathname)) {
    const idToken = request.cookies.get(HARBOR_ID_COOKIE)?.value
    if (!idToken) {
      const loginUrl = request.nextUrl.clone()
      loginUrl.pathname = '/login/aws'
      loginUrl.searchParams.set('next', pathname)
      return NextResponse.redirect(loginUrl)
    }
    return NextResponse.next({ request })
  }

  // ── Legacy Supabase branch ────────────────────────────────────────────────
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  // Allow public routes
  const publicPaths = [
    '/login',
    '/signup',
    '/api/',
    '/onboard',
    '/intake',
    '/_next',
    '/favicon',
    '/privacy',
    '/privacy-policy',
    '/terms',
    '/sms',
    '/reset-password',
    // Public appointment confirm/cancel pages hit from email reminders —
    // the appointment UUID itself is the capability token.
    '/appointments/',
  ]
  const exactPublicPaths = ['/']
  if (exactPublicPaths.includes(pathname) || publicPaths.some(p => pathname.startsWith(p))) {
    return supabaseResponse
  }

  // Not logged in → redirect to login
  if (!user) {
    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = '/login/aws'
    loginUrl.searchParams.set('next', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // Admin-only routes
  if (pathname.startsWith('/admin') && user.email !== ADMIN_EMAIL) {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
