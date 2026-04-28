// app/api/admin/bootstrap-password/route.ts
//
// Wave 18 (AWS port). Emergency password reset for the admin account
// via Cognito AdminSetUserPassword. Bypasses the password-reset email
// flow when SES delivery is broken or the admin lost access.
//
// Auth: Bearer ${CRON_SECRET}. We deliberately keep this on a shared
// secret rather than requireAdminSession() because the admin may be
// locked out and unable to log in — that's the reason this endpoint
// exists in the first place. The CRON_SECRET is rotation-controlled
// and only loaded via SSM.
//
// Hard-restricted to the configured ADMIN_EMAIL — we will NOT let
// this endpoint be used to take over any other user.
//
// Audit captures: target email + Cognito sub + IP + payload hash
// (NOT the password). Audit row is written even on failure so an
// attempted unauthorized reset is forensically visible.

import { NextRequest, NextResponse } from 'next/server'
import {
  CognitoIdentityProviderClient,
  AdminSetUserPasswordCommand,
  AdminGetUserCommand,
} from '@aws-sdk/client-cognito-identity-provider'
import { auditSystemEvent } from '@/lib/aws/ehr/audit'
import { hashAdminPayload } from '@/lib/aws/admin/payload-hash'

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'chancewonser@gmail.com')
  .toLowerCase()
const COGNITO_REGION = process.env.COGNITO_REGION || 'us-east-1'
const COGNITO_USER_POOL_ID = process.env.COGNITO_USER_POOL_ID || ''

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') || ''
  const expected = `Bearer ${process.env.CRON_SECRET || ''}`
  const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || null

  if (!process.env.CRON_SECRET || auth !== expected) {
    await auditSystemEvent({
      action: 'admin.bootstrap_password',
      severity: 'warning',
      details: { outcome: 'unauthorized', ip },
    })
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { email?: string; new_password?: string } = {}
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const email = body.email?.toLowerCase().trim()
  const newPassword = body.new_password
  const payloadHash = hashAdminPayload({ email, password_length: newPassword?.length ?? 0 })

  if (!email || !newPassword) {
    return NextResponse.json({ error: 'email and new_password required' }, { status: 400 })
  }
  if (newPassword.length < 8) {
    return NextResponse.json({ error: 'new_password must be at least 8 chars' }, { status: 400 })
  }
  if (email !== ADMIN_EMAIL) {
    await auditSystemEvent({
      action: 'admin.bootstrap_password',
      severity: 'warning',
      details: {
        // Wave 41 / T0 — attempted_email renamed + hashed. The runtime
        // sanitizer blocks `attempted_email` as PHI; this email is
        // the admin's own (operator data) but the policy is uniform.
        outcome: 'forbidden_non_admin_email',
        actor_email_hash: hashAdminPayload({ email }),
        ip,
        payload_hash: payloadHash,
      },
    })
    return NextResponse.json(
      { error: 'Only the ADMIN_EMAIL account can be reset via this endpoint' },
      { status: 403 },
    )
  }

  if (!COGNITO_USER_POOL_ID) {
    return NextResponse.json(
      { error: 'COGNITO_USER_POOL_ID not configured' },
      { status: 500 },
    )
  }

  const cog = new CognitoIdentityProviderClient({ region: COGNITO_REGION })

  // Look up the Cognito user — admin's username is typically the email.
  let cognitoSub: string | null = null
  try {
    const got = await cog.send(
      new AdminGetUserCommand({
        UserPoolId: COGNITO_USER_POOL_ID,
        Username: email,
      }),
    )
    cognitoSub = got.UserAttributes?.find((a) => a.Name === 'sub')?.Value ?? null
  } catch (err) {
    await auditSystemEvent({
      action: 'admin.bootstrap_password',
      severity: 'warning',
      details: { outcome: 'admin_get_user_failed', error: (err as Error).message, ip, payload_hash: payloadHash },
    })
    return NextResponse.json({ error: 'admin user not found' }, { status: 404 })
  }

  // Set the password as Permanent so the user is not forced into the
  // FORCE_CHANGE_PASSWORD flow on next login.
  try {
    await cog.send(
      new AdminSetUserPasswordCommand({
        UserPoolId: COGNITO_USER_POOL_ID,
        Username: email,
        Password: newPassword,
        Permanent: true,
      }),
    )
  } catch (err) {
    await auditSystemEvent({
      action: 'admin.bootstrap_password',
      severity: 'warning',
      details: {
        outcome: 'admin_set_password_failed',
        error: (err as Error).message,
        ip,
        cognito_sub: cognitoSub,
        payload_hash: payloadHash,
      },
    })
    return NextResponse.json({ error: 'admin password reset failed' }, { status: 500 })
  }

  await auditSystemEvent({
    action: 'admin.bootstrap_password',
    severity: 'info',
    details: {
      // Wave 41 / T0 — target_email renamed + hashed (sanitizer blocklist).
      outcome: 'success',
      subject_email_hash: hashAdminPayload({ email }),
      cognito_sub: cognitoSub,
      ip,
      payload_hash: payloadHash,
    },
  })

  return NextResponse.json({ ok: true, email, cognito_sub: cognitoSub })
}
