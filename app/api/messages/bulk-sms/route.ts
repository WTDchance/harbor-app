// app/api/messages/bulk-sms/route.ts
//
// Wave 27d (AWS port). Bulk SMS over SignalWire. Cookie auth +
// pool-only patient resolution (no Twilio, no Supabase). Recipients
// are pulled from upcoming or by-date appointments per the existing
// dashboard contract; sends fire serially through lib/aws/signalwire.

import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/aws/db'
import { requireApiSession } from '@/lib/aws/api-auth'
import { getEffectivePracticeId } from '@/lib/active-practice'
import { sendSMS } from '@/lib/aws/signalwire'
import { auditSystemEvent } from '@/lib/aws/ehr/audit'

function formatTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key: string) => vars[key] ?? '')
}

export async function POST(req: NextRequest) {
  const ctx = await requireApiSession()
  if (ctx instanceof NextResponse) return ctx

  const practiceId = await getEffectivePracticeId(null, { email: ctx.session.email, id: ctx.user.id })
  if (!practiceId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const { message_template, recipient_type, date } = body
  if (!message_template || typeof message_template !== 'string') {
    return NextResponse.json({ error: 'Message template required' }, { status: 400 })
  }

  // Pull recipients from appointments — AWS canonical scheduled_for.
  let where = `practice_id = $1 AND patient_phone IS NOT NULL AND patient_phone <> '' AND status <> 'cancelled'`
  const params: any[] = [practiceId]
  if (recipient_type === 'by_date' && typeof date === 'string') {
    params.push(date)
    where += ` AND scheduled_for::date = $${params.length}`
  } else if (recipient_type === 'upcoming') {
    params.push(new Date().toISOString())
    where += ` AND scheduled_for >= $${params.length}`
    params.push(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString())
    where += ` AND scheduled_for <= $${params.length}`
  }

  const { rows: appts } = await pool.query(
    `SELECT patient_name, patient_phone, scheduled_for FROM appointments WHERE ${where}`,
    params,
  )
  if (appts.length === 0) {
    return NextResponse.json({ sent: 0, failed: 0, total: 0 })
  }

  // Dedupe by phone, retain first appointment for substitution context
  const byPhone = new Map<string, { name: string; when: string }>()
  for (const a of appts) {
    if (!byPhone.has(a.patient_phone)) {
      byPhone.set(a.patient_phone, {
        name: a.patient_name || '',
        when: a.scheduled_for ? new Date(a.scheduled_for).toLocaleString() : '',
      })
    }
  }

  let sent = 0
  let failed = 0
  for (const [phone, ctxVars] of byPhone) {
    const messageBody = formatTemplate(message_template, {
      patient_name: ctxVars.name,
      appointment_time: ctxVars.when,
    })
    const result = await sendSMS({ to: phone, body: messageBody, practiceId })
    if (result.ok) sent++
    else failed++
  }

  await auditSystemEvent({
    action: 'signalwire.sms.bulk_send',
    severity: 'info',
    practiceId,
    details: { recipient_type, total: byPhone.size, sent, failed },
  })

  return NextResponse.json({ sent, failed, total: byPhone.size })
}
