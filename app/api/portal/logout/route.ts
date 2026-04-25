// app/api/portal/logout/route.ts — clear the portal session cookie.
import { NextResponse } from 'next/server'
import { clearPortalSessionCookie } from '@/lib/ehr/portal'

export async function POST() {
  await clearPortalSessionCookie()
  return NextResponse.json({ ok: true })
}
