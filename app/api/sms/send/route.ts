// app/api/sms/send/route.ts
//
// Wave 27d (AWS port). Outbound SMS via SignalWire. Cookie auth
// (Cognito session) so internal jobs/admin actions can call it.
// Replaces the legacy Twilio-backed handler.

import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/aws/db'
import { requireApiSession } from '@/lib/aws/api-auth'
import { sendSMS } from '@/lib/aws/signalwire'
import { auditSystemEvent } from '@/lib/aws/ehr/audit'

export async function POST(request: NextRequest) {
  const ctx = await requireApiSession()
  if (ctx instanceof NextResponse) return ctx

  let body: { to?: string; body?: string; practiceId?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }
  const { to, body: messageBody, practiceId } = body
  if (!to || !messageBody || !practiceId) {
    return NextResponse.json(
      { error: 'Missing required fields: to, body, practiceId' },
      { status: 400 },
    )
  }

  // Verify practice exists + caller is allowed (admin or owner)
  const { rows } = await pool.query(
    `SELECT id, name, owner_email FROM practices WHERE id = $1 LIMIT 1`,
    [practiceId],
  )
  if (rows.length === 0) {
    return NextResponse.json({ error: 'practice_not_found' }, { status: 404 })
  }
  const adminEmail = (process.env.ADMIN_EMAIL || '').toLowerCase()
  const isAdmin = !!adminEmail && ctx.session.email.toLowerCase() === adminEmail
  const isOwner = rows[0].owner_email?.toLowerCase() === ctx.session.email.toLowerCase()
  if (!isAdmin && !isOwner) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const result = await sendSMS({ to, body: messageBody, practiceId })
  await auditSystemEvent({
    action: result.ok ? 'signalwire.sms.sent' : 'signalwire.sms.failed',
    severity: result.ok ? 'info' : 'warning',
    practiceId,
    details: result.ok
      ? { to, length: messageBody.length, sid: result.sid }
      : { to, length: messageBody.length, reason: result.reason },
  })
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 502 })
  }
  return NextResponse.json({ ok: true, sid: result.sid })
}
