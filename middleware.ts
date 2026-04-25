import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const ADMIN_EMAIL = process.env.ADMIN_EMAIL
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

  if (isAwsPath(pathname)) {
    const idToken = request.cookies.get(HARBOR_ID_COOKIE)?.value
    console.log('[mw] aws path', JSON.stringify({
      pathname,
      has_id_cookie: !!idToken,
      id_len: idToken?.length || 0,
      cookie_names: request.cookies.getAll().map(c => c.name),
    }))
    if (!idToken) {
      const loginUrl = request.nextUrl.clone()
      loginUrl.pathname = '/login/aws'
      loginUrl.searchParams.set('next', pathname)
      return NextResponse.redirect(loginUrl)
    }
    return NextResponse.next({ request })
  }

  let supabaseResponse = NextResponse.next({ request })
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) => supabaseResponse.cookies.set(name, value, options))
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  const publicPaths = [
    '/login', '/signup', '/api/', '/onboard', '/intake', '/_next', '/favicon',
    '/privacy', '/privacy-policy', '/terms', '/sms', '/reset-password',
    '/appointments/',
  ]
  const exactPublicPaths = ['/']
  if (exactPublicPaths.includes(pathname) || publicPaths.some(p => pathname.startsWith(p))) {
    return supabaseResponse
  }

  if (!user) {
    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = '/login/aws'
    loginUrl.searchParams.set('next', pathname)
    return NextResponse.redirect(loginUrl)
  }

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
