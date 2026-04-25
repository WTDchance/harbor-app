// Patient portal login — exchange a therapist-issued access token for a
// portal session. Sets the harbor_portal_session cookie for web clients
// AND echoes the bare token in the response body so native iOS/Android
// clients can stash it in Keychain/Keystore (per phase-4a portal design).

import { NextResponse, type NextRequest } from 'next/server'
import {
  setPortalSessionCookie,
  verifyAndConsumeLoginToken,
} from '@/lib/aws/portal-auth'
import { auditPortalAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as { token?: unknown } | null
  const token = body?.token
  if (!token || typeof token !== 'string') {
    return NextResponse.json({ error: 'token required' }, { status: 400 })
  }

  const sess = await verifyAndConsumeLoginToken(token)
  if (!sess) {
    return NextResponse.json({ error: 'invalid_or_expired_link' }, { status: 401 })
  }

  await setPortalSessionCookie(token)

  // Best-effort audit trail.
  auditPortalAccess({
    session: sess,
    action: 'portal.login',
    details: { transport: 'token_exchange' },
  }).catch(() => {})

  return NextResponse.json({
    // Echoed for native clients — web ignores this and uses the cookie.
    token,
    patient: {
      id: sess.patientId,
      first_name: sess.firstName,
      last_name: sess.lastName,
    },
  })
}
