import { NextRequest, NextResponse } from 'next/server'
import { getMessage } from '@/lib/agentmail'

export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  const svixId = req.headers.get('svix-id')
  const svixTimestamp = req.headers.get('svix-timestamp')
  const svixSignature = req.headers.get('svix-signature')

  // Verify webhook signature if secret is configured
  if (process.env.AGENTMAIL_WEBHOOK_SECRET) {
    try {
      const { Webhook } = await import('svix')
      const wh = new Webhook(process.env.AGENTMAIL_WEBHOOK_SECRET)
      wh.verify(rawBody, {
        'svix-id': svixId ?? '',
        'svix-timestamp': svixTimestamp ?? '',
        'svix-signature': svixSignature ?? '',
      })
    } catch (err) {
      console.error('[email-webhook] Signature verification failed:', err)
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
