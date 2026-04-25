// Supabase Auth callback — handles magic link redirect
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { writeAuditLog, extractIp } from '@/lib/audit'

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'chancewonser@gmail.com'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const origin = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/dashboard'

  if (code) {
    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return cookieStore.getAll() },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          },
        },
      }
    )

    const { data: { session }, error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error && session?.user) {
      const isAdmin = session.user.email === ADMIN_EMAIL
      const redirectTo = isAdmin ? '/admin' : (next === '/login' ? '/dashboard' : next)

      // Audit: successful login
      await writeAuditLog({
        action: 'login',
        user_id: session.user.id,
        user_email: session.user.email,
        ip_address: extractIp(request.headers),
        user_agent: request.headers.get('user-agent'),
        details: { method: 'magic_link', redirect: redirectTo },
      })

      return NextResponse.redirect(`${origin}${redirectTo}`)
    }
  }

  // Audit: failed login attempt
  await writeAuditLog({
    action: 'login_failed',
    ip_address: extractIp(request.headers),
    user_agent: request.headers.get('user-agent'),
    details: { reason: 'invalid_code' },
    severity: 'warning',
  })

  return NextResponse.redirect(`${origin}/login?error=auth_failed`)
}
