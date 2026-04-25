import { NextRequest, NextResponse } from 'next/server'
import { createHmac } from 'crypto'
import { getMessage } from '@/lib/agentmail'

function verifySvixSignature(
  rawBody: string,
  headers: {
    'svix-id': string
    'svix-timestamp': string
    'svix-signature': string
  },
  secret: string
): boolean {
  const msgId = headers['svix-id']
  const msgTimestamp = headers['svix-timestamp']
  const msgSignature = headers['svix-signature']

  if (!msgId || !msgTimestamp || !msgSignature) return false

  // Reject old timestamps (>5 min)
  const ts = parseInt(msgTimestamp)
  if (Math.abs(Date.now() / 1000 - ts) > 300) return false

  const toSign = msgId + '.' + msgTimestamp + '.' + rawBody
  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
  const computed = createHmac('sha256', secretBytes).update(toSign).digest('base64')

  // Compare against all signatures in the header (space-separated, prefixed with v1,)
  return msgSignature.split(' ').some(sig => {
    const [version, b64] = sig.split(',')
    return version === 'v1' && b64 === computed
  })
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  const svixId = req.headers.get('svix-id')
  const svixTimestamp = req.headers.get('svix-timestamp')
  const svixSignature = req.headers.get('svix-signature')

  // Verify webhook signature if secret is configured
  if (process.env.AGENTMAIL_WEBHOOK_SECRET) {
    const verified = verifySvixSignature(
      rawBody,
      {
        'svix-id': svixId ?? '',
        'svix-timestamp': svixTimestamp ?? '',
        'svix-signature': svixSignature ?? '',
      },
      process.env.AGENTMAIL_WEBHOOK_SECRET
    )

    if (!verified) {
      console.error('[email-webhook] Signature verification failed')
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }
  }

  let event: any
  try {
    event = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  console.log('[email-webhook] Event received:', event.type, event.data?.inbox_id)

  if (event.type === 'message.received') {
    await handleInboundEmail(event.data)
  }

  return NextResponse.json({ received: true })
}

async function handleInboundEmail(data: any) {
  try {
    let { inbox_id, message_id, from, subject, text, html } = data

    // If body was omitted due to size limit, fetch it
    if (!text && !html && inbox_id && message_id) {
      const fullMessage = await getMessage(inbox_id, message_id)
      text = fullMessage.text
      html = fullMessage.html
    }

    console.log('[email-webhook] Inbound email:', {
      inbox_id,
      message_id,
      from,
      subject,
      textLength: text?.length ?? 0,
    })

    // TODO: Route to the correct practice based on inbox_id
    // TODO: Trigger AI agent processing
    // TODO: Log to Supabase conversation history
  } catch (err) {
    console.error('[email-webhook] handleInboundEmail error:', err)
  }
}
