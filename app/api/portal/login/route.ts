// app/api/portal/login/route.ts — patient-side login via access token.
import { NextRequest, NextResponse } from 'next/server'
import { setPortalSessionCookie, verifyAndConsumeLoginToken } from '@/lib/ehr/portal'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const token = body?.token
  if (!token || typeof token !== 'string') {
    return NextResponse.json({ error: 'token required' }, { status: 400 })
  }
  const session = await verifyAndConsumeLoginToken(token)
  if (!session) return NextResponse.json({ error: 'Invalid or expired link' }, { status: 401 })
  await setPortalSessionCookie(token)
  return NextResponse.json({
    patient: {
      id: session.patient_id,
      first_name: session.patient_first_name,
      last_name: session.patient_last_name,
    },
  })
}
