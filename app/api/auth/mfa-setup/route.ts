// app/api/auth/mfa-setup/route.ts
//
// Wave 38 TS3 — TOTP enrollment for therapists.
//
// GET: returns { secret, otpauth_uri } for the QR code. Calls
//   AssociateSoftwareToken with the user's AccessToken (cookie).
// POST { code }: VerifySoftwareToken then SetUserMFAPreference so the
//   secret becomes the user's preferred TOTP factor.

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import {
  CognitoIdentityProviderClient,
  AssociateSoftwareTokenCommand,
  VerifySoftwareTokenCommand,
  SetUserMFAPreferenceCommand,
  GetUserCommand,
} from '@aws-sdk/client-cognito-identity-provider'
import QRCode from 'qrcode'
import { ACCESS_COOKIE } from '@/lib/aws/cognito'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const COGNITO_REGION = process.env.COGNITO_REGION || process.env.AWS_REGION || 'us-east-1'

function client() {
  return new CognitoIdentityProviderClient({ region: COGNITO_REGION })
}

async function getAccessToken(): Promise<string | null> {
  const c = await cookies()
  return c.get(ACCESS_COOKIE)?.value || null
}

export async function GET(_req: NextRequest) {
  const token = await getAccessToken()
  if (!token) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const cli = client()
  const me = await cli.send(new GetUserCommand({ AccessToken: token })).catch(() => null)
  const email = me?.UserAttributes?.find(a => a.Name === 'email')?.Value || 'user'

  const r = await cli.send(new AssociateSoftwareTokenCommand({ AccessToken: token })).catch((err: any) => err)
  if (!r?.SecretCode) {
    return NextResponse.json({ error: r?.name || 'associate_failed' }, { status: 502 })
  }
  const issuer = encodeURIComponent('Harbor')
  const account = encodeURIComponent(email)
  const otpauth_uri = `otpauth://totp/${issuer}:${account}?secret=${r.SecretCode}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`

  // Generate the QR locally as a data URL so the secret never leaves our
  // infrastructure. The previous client-side <img src=api.qrserver.com> call
  // (a) leaked the TOTP secret + user email to a third party we don't have
  // a BAA with, and (b) failed to render whenever that third-party endpoint
  // was unreachable. Using the already-bundled `qrcode` npm package keeps it
  // inline + HIPAA-clean.
  let qr_data_url: string | null = null
  try {
    qr_data_url = await QRCode.toDataURL(otpauth_uri, {
      width: 256,
      margin: 1,
      errorCorrectionLevel: 'M',
    })
  } catch {
    // Fall back to text-only display if QR encoding fails for any reason.
    qr_data_url = null
  }

  return NextResponse.json({ secret: r.SecretCode, otpauth_uri, qr_data_url })
}

export async function POST(req: NextRequest) {
  const token = await getAccessToken()
  if (!token) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null) as any
  const code = (body?.code || '').trim()
  if (!code) return NextResponse.json({ error: 'code required' }, { status: 400 })

  const cli = client()
  let verifyR
  try {
    verifyR = await cli.send(new VerifySoftwareTokenCommand({
      AccessToken: token,
      UserCode: code,
      FriendlyDeviceName: 'Authenticator app',
    }))
  } catch (err: any) {
    return NextResponse.json({ error: err?.name || 'verify_failed' }, { status: 401 })
  }
  if (verifyR.Status !== 'SUCCESS') {
    return NextResponse.json({ error: verifyR.Status || 'verify_failed' }, { status: 401 })
  }

  // Make TOTP the preferred MFA so subsequent logins challenge for it.
  await cli.send(new SetUserMFAPreferenceCommand({
    AccessToken: token,
    SoftwareTokenMfaSettings: { Enabled: true, PreferredMfa: true },
  }))

  return NextResponse.json({ ok: true })
}
