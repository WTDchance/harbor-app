import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { writeAuditLog, extractIp } from '@/lib/audit'

async function handleLogout(request?: NextRequest) {
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

  // Get user before sign out so we can log it
  const { data: { user } } = await supabase.auth.getUser()

  await supabase.auth.signOut()

  // Audit: logout
  if (user) {
    await writeAuditLog({
      action: 'logout',
      user_id: user.id,
      user_email: user.email,
      ip_address: request ? extractIp(request.headers) : null,
      user_agent: request?.headers.get('user-agent') ?? null,
    })
  }

  return NextResponse.redirect(new URL('/login', 'http://localhost').href.replace('http://localhost', ''))
}

export async function GET(request: NextRequest) {
  return handleLogout(request)
}

export async function POST(request: NextRequest) {
  return handleLogout(request)
}
