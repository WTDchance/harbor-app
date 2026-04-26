// AWS SES email client for Harbor.
//
// Replaces the Resend SaaS provider. The IAM policy on the ECS task role
// (infra/terraform/iam.tf) restricts ses:SendEmail Source: to a single
// address (var.ses_from_address). That means every outbound email leaves
// from SES_FROM_ADDRESS regardless of what the caller asked for as `from`.
// To preserve the threading-hint intent of the legacy Chance@/Sales@/
// Support@ routing, the caller's requested `from` is moved into the
// ReplyTo header.
//
// Production note: SES starts in "sandbox mode" — the account can only send
// to verified email addresses until AWS approves a sandbox-removal request.
// Sends to unverified recipients fail with MessageRejected. We log + return
// false (same posture as the legacy Resend stub when API key was missing)
// so the calling route never blocks on email failures.

import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses'

let _client: SESClient | null = null

function getClient(): SESClient {
  if (!_client) {
    _client = new SESClient({
      region: process.env.AWS_REGION || 'us-east-1',
    })
  }
  return _client
}

export function sesFromAddress(): string {
  return (
    process.env.SES_FROM_ADDRESS ||
    process.env.RESEND_FROM_EMAIL || // legacy fallback during migration
    'ellie@harboroffice.ai'
  )
}

export type SesPayload = {
  to: string
  subject: string
  html: string
  text?: string
  /** Caller's intended sender — moves into Reply-To since SES Source is
   *  pinned by IAM. */
  replyTo?: string
}

export async function sendViaSes(payload: SesPayload): Promise<boolean> {
  const source = sesFromAddress()

  const replyToAddresses: string[] = []
  if (payload.replyTo && payload.replyTo !== source) {
    // Resend's `from` field is sometimes a "Name <addr@dom>" — if it has
    // angle brackets pull the address out so SES gets a clean header value.
    const m = payload.replyTo.match(/<([^>]+)>/)
    replyToAddresses.push(m ? m[1] : payload.replyTo)
  }

  const cmd = new SendEmailCommand({
    Source: source,
    Destination: { ToAddresses: [payload.to] },
    Message: {
      Subject: { Data: payload.subject, Charset: 'UTF-8' },
      Body: {
        Html: { Data: payload.html, Charset: 'UTF-8' },
        ...(payload.text ? { Text: { Data: payload.text, Charset: 'UTF-8' } } : {}),
      },
    },
    ReplyToAddresses: replyToAddresses.length ? replyToAddresses : undefined,
  })

  try {
    await getClient().send(cmd)
    console.log(`[ses] sent to ${payload.to}: ${payload.subject}`)
    return true
  } catch (err) {
    const e = err as Error & { name?: string }
    // Sandbox-mode rejections + verification failures are a known mode in
    // staging — log warn rather than error so they're visible but don't
    // page anyone.
    if (e?.name === 'MessageRejected' || /not verified|sandbox/i.test(e?.message || '')) {
      console.warn('[ses] send rejected (likely sandbox / unverified):', e.message)
    } else {
      console.error('[ses] send failed:', e.message, e.name)
    }
    return false
  }
}
