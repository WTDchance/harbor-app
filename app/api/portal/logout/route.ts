// Patient portal logout — clear the cookie. Bearer-only clients (native)
// just discard the token; this endpoint is harmless for them but they
// don't actually need to call it.

import { NextResponse } from 'next/server'
import {
  getPortalSession,
  clearPortalSessionCookie,
} from '@/lib/aws/portal-auth'
import { auditPortalAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST() {
  // Audit before clearing — we want the session info on the row.
  const sess = await getPortalSession()
  if (sess) {
    auditPortalAccess({ session: sess, action: 'portal.logout' }).catch(() => {})
  }
  await clearPortalSessionCookie()
  return NextResponse.json({ ok: true })
}
