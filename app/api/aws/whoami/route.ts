// Returns the authenticated Cognito user + their practice. Used by client
// components that need email/practice for chrome (sidebar header etc).
//
// Returns 401 if not signed in. Client treats that as "redirect to /login/aws".

import { NextResponse } from 'next/server'
import { getServerSession } from '@/lib/aws/session'
import { getUserAndPractice } from '@/lib/aws/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getServerSession()
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let practice: { id: string; name: string } | null = null
  let role: string | null = null
  try {
    const row = await getUserAndPractice(session.sub)
    if (row?.practice) practice = { id: row.practice.id, name: row.practice.name }
    if (row?.user) role = row.user.role
  } catch {
    // DB unreachable shouldn't block the auth check — chrome can render without practice.
  }

  return NextResponse.json({
    sub: session.sub,
    email: session.email,
    emailVerified: session.emailVerified,
    role,
    practice,
  })
}
