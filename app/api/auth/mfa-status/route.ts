// app/api/auth/mfa-status/route.ts
//
// Wave 38 TS3 — used by the dashboard layout to nudge un-enrolled
// therapists into the MFA setup flow on first login post-deploy.
//
// Returns:
//   { enrolled: boolean, required: boolean }
//
// `required` = caller's role is therapist-shaped AND no TOTP enrolled.

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { CognitoIdentityProviderClient, GetUserCommand } from '@aws-sdk/client-cognito-identity-provider'
import { ACCESS_COOKIE } from '@/lib/aws/cognito'
import { requireApiSession } from '@/lib/aws/api-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const THERAPIST_ROLES = new Set(['clinician', 'therapist', 'admin', 'owner'])

export async function GET(_req: NextRequest) {
  const ctx = await requireApiSession()
  if (ctx instanceof NextResponse) return ctx

  const c = await cookies()
  const token = c.get(ACCESS_COOKIE)?.value
  if (!token) return NextResponse.json({ enrolled: false, required: false })

  const cli = new CognitoIdentityProviderClient({
    region: process.env.COGNITO_REGION || process.env.AWS_REGION || 'us-east-1',
  })
  let me
  try {
    me = await cli.send(new GetUserCommand({ AccessToken: token }))
  } catch {
    return NextResponse.json({ enrolled: false, required: false })
  }

  const enrolled =
    !!me.PreferredMfaSetting && me.PreferredMfaSetting.length > 0 ||
    (me.UserMFASettingList || []).includes('SOFTWARE_TOKEN_MFA')

  const role = (ctx.user as any)?.role || 'clinician'
  const required = THERAPIST_ROLES.has(role) && !enrolled

  return NextResponse.json({ enrolled, required })
}
