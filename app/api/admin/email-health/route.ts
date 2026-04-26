// Harbor — Email infrastructure diagnostic (AWS SES port).
//
// GET  /api/admin/email-health  — env var presence + SES verified
//   identities for the configured domain. Safe to expose (no secrets).
// POST /api/admin/email-health?to=<addr> — sends a test email via SES.
//   Auth: Bearer CRON_SECRET so this can run without an admin session
//   while we debug an email outage.

import { NextResponse, type NextRequest } from 'next/server'
import {
  SESClient,
  GetIdentityVerificationAttributesCommand,
} from '@aws-sdk/client-ses'
import { sendViaSes, sesFromAddress } from '@/lib/aws/ses'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function authed(req: NextRequest): boolean {
  const auth = req.headers.get('authorization') || ''
  const expected = `Bearer ${process.env.CRON_SECRET || ''}`
  return !!process.env.CRON_SECRET && auth === expected
}

async function fetchSesVerificationStatus(): Promise<{
  ok: boolean
  identities: Record<string, string>
  error?: string
}> {
  try {
    const client = new SESClient({ region: process.env.AWS_REGION || 'us-east-1' })
    const fromAddr = sesFromAddress()
    const fromDomain = fromAddr.includes('@') ? fromAddr.split('@')[1] : fromAddr
    const cmd = new GetIdentityVerificationAttributesCommand({
      Identities: [fromAddr, fromDomain],
    })
    const out = await client.send(cmd)
    const identities: Record<string, string> = {}
    for (const [k, v] of Object.entries(out.VerificationAttributes ?? {})) {
      identities[k] = v?.VerificationStatus ?? 'unknown'
    }
    return { ok: true, identities }
  } catch (err) {
    return { ok: false, identities: {}, error: (err as Error).message }
  }
}

export async function GET(req: NextRequest) {
  if (!authed(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const env = {
    AWS_REGION: process.env.AWS_REGION || null,
    SES_FROM_ADDRESS: process.env.SES_FROM_ADDRESS || null,
    RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL || null, // legacy fallback
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL || null,
    ADMIN_EMAIL: process.env.ADMIN_EMAIL || null,
  }

  const ses = await fetchSesVerificationStatus()

  return NextResponse.json({
    provider: 'aws_ses',
    from: sesFromAddress(),
    env,
    ses,
  })
}

export async function POST(req: NextRequest) {
  if (!authed(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const to = url.searchParams.get('to')
  if (!to) {
    return NextResponse.json({ error: '?to= required' }, { status: 400 })
  }

  const sent = await sendViaSes({
    to,
    subject: 'Harbor SES test',
    html: `<p>This is a test email from <strong>${sesFromAddress()}</strong> sent at ${new Date().toISOString()}.</p>`,
    text: `Harbor SES test sent at ${new Date().toISOString()}.`,
  })

  return NextResponse.json({
    from: sesFromAddress(),
    to,
    sent_at: new Date().toISOString(),
    sent,
  })
}
