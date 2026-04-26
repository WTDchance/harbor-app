// app/api/signalwire/sms-status/route.ts
//
// Wave 27d — SignalWire delivery status callback. Logged for ops
// visibility; the dashboard's sms_conversations row is the source of
// truth for conversation state.

import { NextRequest, NextResponse } from 'next/server'
import { auditSystemEvent } from '@/lib/aws/ehr/audit'

export async function POST(req: NextRequest) {
  const formData = await req.formData()
  const params: Record<string, string> = {}
  for (const [k, v] of formData.entries()) params[k] = String(v)
  await auditSystemEvent({
    action: 'signalwire.sms_status',
    severity: 'info',
    details: {
      message_sid: params.MessageSid || null,
      message_status: params.MessageStatus || null,
      to: params.To,
      error_code: params.ErrorCode || null,
    },
  })
  // 204 + body throws on Next 14's strict Response constructor; 200 with no body is equivalent for SignalWire callbacks.
  return new NextResponse(null, { status: 200 })
}
