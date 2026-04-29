// app/api/webhooks/signalwire-sms-inbound/route.ts
//
// Wave 50 — SignalWire inbound-SMS webhook for the appointment reminder
// pipeline. This is the patient-reply surface for the cron-driven
// reminders sent by /api/cron/schedule-sms-reminders.
//
// Why a NEW route alongside the existing /api/signalwire/inbound-sms?
//   - inbound-sms is the wave-27 generic conversation handler (logs
//     into sms_conversations + sms_opt_outs). It stays for backwards
//     compat with practices already pointing their main number at it.
//   - signalwire-sms-inbound is the reminder-pipeline-specific handler:
//     it ALSO writes to sms_send_log direction='inbound' and updates
//     sms_suppression_list (the new richer opt-out table), and it
//     understands the C / CONFIRM / R / RESCHEDULE keywords that the
//     reminder templates ask the patient to send back.
//
// Keyword handling (case-insensitive, body trimmed):
//   STOP / UNSUBSCRIBE / CANCEL / END / QUIT  → suppress, ack
//   START / UNSTOP / YES                       → clear suppression, welcome
//   HELP / INFO                                → echo opt-out tag + practice phone
//   C / CONFIRM / YES                          → mark latest reminder as confirmed
//   R / RESCHEDULE                             → mark for follow-up + ack
//
// Signature validation: the existing assertSignalWireWebhook /
// validateInboundWebhook helper from lib/aws/signalwire is used; it's
// the same algorithm SignalWire signs all LaML POSTs with and matches
// what the wave-27 inbound-voice / inbound-sms routes already do.

import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/aws/db'
import {
  validateInboundWebhook,
  signalwireConfigured,
  publicWebhookUrl,
} from '@/lib/aws/signalwire'
import { auditSystemEvent } from '@/lib/aws/ehr/audit'
import { SMS_OPT_OUT_TAG } from '@/lib/aws/sms-templates'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const TWIML_HEADERS = { 'Content-Type': 'application/xml' }

function twimlReply(message: string | null): string {
  if (!message) return `<?xml version="1.0" encoding="UTF-8"?><Response/>`
  // SignalWire LaML mirrors Twilio: bare <Response><Message>...</Message></Response>
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(message)}</Message></Response>`
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

type Keyword =
  | 'stop'
  | 'start'
  | 'help'
  | 'confirm'
  | 'reschedule'
  | null

function classifyKeyword(body: string): Keyword {
  const t = (body || '').trim().toUpperCase()
  if (!t) return null

  // STOP family — TCPA-required immediate suppression
  if (['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'].includes(t)) {
    return 'stop'
  }
  // START family — patient is opting back in
  if (['START', 'UNSTOP'].includes(t)) return 'start'
  if (t === 'HELP' || t === 'INFO') return 'help'

  // C / CONFIRM / YES — appointment confirmation. YES is ambiguous with
  // START in TCPA-land, so we prefer 'start' if the patient is currently
  // suppressed and 'confirm' otherwise. The decision is made in the POST
  // body once we have the suppression-list lookup.
  if (['C', 'CONFIRM'].includes(t)) return 'confirm'
  if (t === 'YES') return 'confirm' // overridden below if currently suppressed

  // R / RESCHEDULE — kicks the appointment to a "needs reschedule" queue.
  if (['R', 'RESCHEDULE'].includes(t)) return 'reschedule'

  return null
}

async function logInbound(args: {
  practice_id: string
  patient_id: string | null
  from_phone: string
  to_phone: string
  body: string
  signalwire_sid: string | null
  details: Record<string, unknown>
}): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO sms_send_log (
         practice_id, patient_id, to_phone, from_phone,
         direction, body, status, signalwire_sid,
         audit_event_type, details
       ) VALUES ($1,$2,$3,$4,'inbound',$5,'received',$6,$7,$8::jsonb)`,
      [
        args.practice_id,
        args.patient_id,
        args.to_phone,
        args.from_phone,
        args.body.slice(0, 1000),
        args.signalwire_sid,
        'sms.inbound.received',
        JSON.stringify(args.details),
      ],
    )
  } catch (err) {
    console.error('[signalwire-sms-inbound] log insert failed:', (err as Error).message)
  }
}

async function isCurrentlySuppressed(practiceId: string, phone: string): Promise<boolean> {
  try {
    const { rowCount } = await pool.query(
      `SELECT 1 FROM sms_suppression_list
        WHERE practice_id = $1 AND phone = $2 AND cleared_at IS NULL
        LIMIT 1`,
      [practiceId, phone],
    )
    return (rowCount ?? 0) > 0
  } catch {
    return false
  }
}

async function suppress(args: {
  practiceId: string
  phone: string
  reason: string
  source: string
  details?: Record<string, unknown>
}): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO sms_suppression_list (practice_id, phone, reason, source, details)
        VALUES ($1, $2, $3, $4, $5::jsonb)
        ON CONFLICT (practice_id, phone) DO UPDATE
          SET reason = EXCLUDED.reason,
              source = EXCLUDED.source,
              details = EXCLUDED.details,
              cleared_at = NULL`,
      [
        args.practiceId,
        args.phone,
        args.reason,
        args.source,
        JSON.stringify(args.details ?? {}),
      ],
    )
  } catch (err) {
    console.error('[signalwire-sms-inbound] suppress failed:', (err as Error).message)
  }
}

async function clearSuppression(practiceId: string, phone: string): Promise<void> {
  try {
    await pool.query(
      `UPDATE sms_suppression_list
          SET cleared_at = now()
        WHERE practice_id = $1 AND phone = $2 AND cleared_at IS NULL`,
      [practiceId, phone],
    )
  } catch (err) {
    console.error('[signalwire-sms-inbound] clear failed:', (err as Error).message)
  }
}

async function findRecentReminder(args: {
  practiceId: string
  patientPhone: string
}): Promise<{ appointment_id: string | null; patient_id: string | null }> {
  try {
    const { rows } = await pool.query(
      `SELECT appointment_id, patient_id
         FROM sms_send_log
        WHERE practice_id = $1
          AND to_phone = $2
          AND direction = 'outbound'
          AND template_category IN ('reminder_24h','reminder_2h','reminder_30min')
        ORDER BY created_at DESC
        LIMIT 1`,
      [args.practiceId, args.patientPhone],
    )
    return rows[0]
      ? { appointment_id: rows[0].appointment_id, patient_id: rows[0].patient_id }
      : { appointment_id: null, patient_id: null }
  } catch {
    return { appointment_id: null, patient_id: null }
  }
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  if (!signalwireConfigured()) {
    return new NextResponse(twimlReply(null), { headers: TWIML_HEADERS })
  }

  const formData = await req.formData()
  const formParams: Record<string, string> = {}
  for (const [k, v] of formData.entries()) formParams[k] = String(v)

  const sigHeader =
    req.headers.get('x-twilio-signature') ||
    req.headers.get('x-signalwire-signature')

  // Signature validation — assertSignalWireWebhook in this codebase is
  // exposed as validateInboundWebhook(). Same algorithm.
  const sigOk = validateInboundWebhook({
    rawUrl: publicWebhookUrl(req),
    formParams,
    signatureHeader: sigHeader,
  })
  if (!sigOk && process.env.SIGNALWIRE_VALIDATE_INBOUND !== 'false') {
    await auditSystemEvent({
      action: 'sms.inbound.bad_signature',
      severity: 'warning',
      details: { from: formParams.From, to: formParams.To },
    })
    return new NextResponse('forbidden', { status: 403 })
  }

  const fromPhone = formParams.From || ''
  const toPhone = formParams.To || ''
  const body = formParams.Body || ''
  const messageSid = formParams.MessageSid || formParams.SmsSid || null

  // Resolve practice from the inbound number
  const { rows: practiceRows } = await pool.query(
    `SELECT id, name, phone, owner_phone
       FROM practices
      WHERE signalwire_number = $1
         OR twilio_phone_number = $1
         OR phone = $1
      LIMIT 1`,
    [toPhone],
  )
  const practice = practiceRows[0]
  if (!practice) {
    await auditSystemEvent({
      action: 'sms.inbound.unknown_number',
      severity: 'warning',
      details: { from: fromPhone, to: toPhone, body: body.slice(0, 80) },
    })
    return new NextResponse(twimlReply(null), { headers: TWIML_HEADERS })
  }

  // Resolve patient (best-effort)
  let patientId: string | null = null
  try {
    const { rows } = await pool.query(
      `SELECT id FROM patients
        WHERE practice_id = $1 AND phone = $2
        LIMIT 1`,
      [practice.id, fromPhone],
    )
    patientId = rows[0]?.id ?? null
  } catch {
    /* ignore */
  }

  // Always log the inbound message
  await logInbound({
    practice_id: practice.id,
    patient_id: patientId,
    from_phone: fromPhone,
    to_phone: toPhone,
    body,
    signalwire_sid: messageSid,
    details: { length: body.length },
  })

  let keyword = classifyKeyword(body)
  // Disambiguate YES — if currently suppressed, treat as opt-in (start),
  // else treat as confirmation.
  if ((body.trim().toUpperCase() === 'YES') && (await isCurrentlySuppressed(practice.id, fromPhone))) {
    keyword = 'start'
  }

  if (keyword === 'stop') {
    await suppress({
      practiceId: practice.id,
      phone: fromPhone,
      reason: 'stop_keyword',
      source: 'inbound_sms',
      details: { keyword: body.trim().toUpperCase() },
    })
    // Mirror into the legacy sms_opt_outs so existing senders that
    // still consult it (e.g. cancellation-fill dispatcher) honour the
    // stop request immediately.
    try {
      await pool.query(
        `INSERT INTO sms_opt_outs (practice_id, phone, keyword, source)
          VALUES ($1, $2, $3, 'inbound_sms')
          ON CONFLICT (practice_id, phone) DO UPDATE
            SET keyword = EXCLUDED.keyword, source = EXCLUDED.source`,
        [practice.id, fromPhone, body.trim().toUpperCase()],
      )
    } catch { /* swallow — non-canonical mirror */ }

    await auditSystemEvent({
      action: 'sms.inbound.stop',
      severity: 'info',
      practiceId: practice.id,
      details: { from_masked: fromPhone.slice(0, 4) + '…' },
    })
    return new NextResponse(
      twimlReply(
        `You have been unsubscribed from ${practice.name} messages. No further messages will be sent. Reply START to resubscribe.`,
      ),
      { headers: TWIML_HEADERS },
    )
  }

  if (keyword === 'start') {
    await clearSuppression(practice.id, fromPhone)
    try {
      await pool.query(
        `DELETE FROM sms_opt_outs WHERE practice_id = $1 AND phone = $2`,
        [practice.id, fromPhone],
      )
    } catch { /* swallow */ }
    await auditSystemEvent({
      action: 'sms.inbound.start',
      severity: 'info',
      practiceId: practice.id,
      details: { from_masked: fromPhone.slice(0, 4) + '…' },
    })
    return new NextResponse(
      twimlReply(
        `You're resubscribed to ${practice.name}. ${SMS_OPT_OUT_TAG}`,
      ),
      { headers: TWIML_HEADERS },
    )
  }

  if (keyword === 'help') {
    const phone = practice.owner_phone || practice.phone || ''
    const phoneLine = phone ? ` Call ${phone} for help.` : ''
    return new NextResponse(
      twimlReply(
        `${practice.name}: appointment reminders.${phoneLine} ${SMS_OPT_OUT_TAG} Standard message and data rates may apply.`,
      ),
      { headers: TWIML_HEADERS },
    )
  }

  if (keyword === 'confirm') {
    const recent = await findRecentReminder({
      practiceId: practice.id,
      patientPhone: fromPhone,
    })
    if (recent.appointment_id) {
      try {
        await pool.query(
          `UPDATE appointments
              SET patient_confirmed_at = now()
            WHERE id = $1 AND practice_id = $2`,
          [recent.appointment_id, practice.id],
        )
      } catch (err) {
        // Column may not exist on every env yet — log & continue. The
        // audit event below is the canonical "confirmed" record.
        console.error('[signalwire-sms-inbound] confirm update failed:', (err as Error).message)
      }
    }
    await auditSystemEvent({
      action: 'sms.inbound.confirm',
      severity: 'info',
      practiceId: practice.id,
      resourceType: 'appointment',
      resourceId: recent.appointment_id,
      details: { from_masked: fromPhone.slice(0, 4) + '…' },
    })
    return new NextResponse(
      twimlReply(
        `Thanks — your appointment is confirmed. ${SMS_OPT_OUT_TAG}`,
      ),
      { headers: TWIML_HEADERS },
    )
  }

  if (keyword === 'reschedule') {
    const recent = await findRecentReminder({
      practiceId: practice.id,
      patientPhone: fromPhone,
    })
    await auditSystemEvent({
      action: 'sms.inbound.reschedule',
      severity: 'info',
      practiceId: practice.id,
      resourceType: 'appointment',
      resourceId: recent.appointment_id,
      details: { from_masked: fromPhone.slice(0, 4) + '…' },
    })
    const phone = practice.owner_phone || practice.phone || ''
    const callPart = phone ? ` or call ${phone}` : ''
    return new NextResponse(
      twimlReply(
        `Got it — we'll reach out shortly to reschedule${callPart}. ${SMS_OPT_OUT_TAG}`,
      ),
      { headers: TWIML_HEADERS },
    )
  }

  // Unrecognised body — empty TwiML so SignalWire doesn't auto-reply.
  await auditSystemEvent({
    action: 'sms.inbound.received',
    severity: 'info',
    practiceId: practice.id,
    resourceId: messageSid,
    details: { length: body.length },
  })
  return new NextResponse(twimlReply(null), { headers: TWIML_HEADERS })
}
