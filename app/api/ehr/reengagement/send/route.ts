// app/api/ehr/reengagement/send/route.ts
//
// W43 T4 — actually send the outreach via the configured channel.
// Body: { campaign_id, patient_ids: string[] }
//
// Resolution:
//   campaign.channel === 'email'           → SES
//   campaign.channel === 'sms'             → SignalWire
//   campaign.channel === 'patient_choice'  → patient.communication_preference
//                                             (defaults to email if unset)
//
// One ehr_reengagement_outreach row per patient regardless of send
// outcome — keeps the dashboard's "tried but failed" surface honest.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
import { sendPatientEmail } from '@/lib/email'
import { sendSMS } from '@/lib/aws/signalwire'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function fillTemplate(text: string, vars: Record<string, string>): string {
  return text.replace(/{{\s*(\w+)\s*}}/g, (_m, k) => vars[k] ?? '')
}

export async function POST(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const body = await req.json().catch(() => null)
  if (!body?.campaign_id || !Array.isArray(body.patient_ids)) {
    return NextResponse.json({ error: 'campaign_id and patient_ids[] required' }, { status: 400 })
  }
  const patientIds = (body.patient_ids as unknown[]).map(String).slice(0, 200)

  const cRes = await pool.query(
    `SELECT id, name, channel, subject, body
       FROM ehr_reengagement_campaigns
      WHERE id = $1 AND practice_id = $2 AND active = TRUE
      LIMIT 1`,
    [body.campaign_id, ctx.practiceId],
  )
  const campaign = cRes.rows[0]
  if (!campaign) return NextResponse.json({ error: 'campaign_not_found' }, { status: 404 })

  const pRes = await pool.query(
    `SELECT p.id, p.first_name, p.last_name, p.email, p.phone,
            p.communication_preference,
            pr.name AS practice_name
       FROM patients p
       JOIN practices pr ON pr.id = p.practice_id
      WHERE p.id = ANY($1::uuid[]) AND p.practice_id = $2`,
    [patientIds, ctx.practiceId],
  )
  const patients = pRes.rows

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://harborreceptionist.com'
  let sentCount = 0
  let failedCount = 0

  for (const p of patients) {
    const vars: Record<string, string> = {
      first_name: p.first_name || 'there',
      last_name: p.last_name || '',
      practice_name: p.practice_name || 'your therapist',
      schedule_link: `${appUrl}/portal/login`,
    }

    let channel: 'email' | 'sms' = campaign.channel === 'sms' ? 'sms' : 'email'
    if (campaign.channel === 'patient_choice') {
      const pref = (p.communication_preference || 'email').toLowerCase()
      channel = pref === 'sms' ? 'sms' : 'email'
    }

    let status: 'sent' | 'failed' = 'failed'
    let failedReason: string | null = null

    try {
      if (channel === 'email' && p.email) {
        const filled = fillTemplate(campaign.body, vars)
        const result = await sendPatientEmail({
          practiceId: ctx.practiceId,
          to: p.email,
          subject: campaign.subject ? fillTemplate(campaign.subject, vars) : `A note from ${vars.practice_name}`,
          html: `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.6; max-width: 560px;">${filled.replace(/\n/g, '<br/>')}</div>`,
        })
        if (result.sent) status = 'sent'
        else failedReason = result.skipped || 'email_send_failed'
      } else if (channel === 'sms' && p.phone) {
        const filled = fillTemplate(campaign.body, vars)
        const result = await sendSMS({
          to: p.phone,
          body: filled,
          practiceId: ctx.practiceId,
        })
        if (result.ok) status = 'sent'
        else failedReason = result.reason || 'sms_send_failed'
      } else {
        failedReason = channel === 'email' ? 'no_email_on_file' : 'no_phone_on_file'
      }
    } catch (err) {
      failedReason = (err as Error).message
    }

    await pool.query(
      `INSERT INTO ehr_reengagement_outreach
         (practice_id, patient_id, campaign_id, channel, status,
          sent_at, failed_reason, initiated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        ctx.practiceId,
        p.id,
        campaign.id,
        channel,
        status,
        status === 'sent' ? new Date().toISOString() : null,
        failedReason,
        ctx.userId,
      ],
    )

    if (status === 'sent') sentCount++
    else failedCount++
  }

  await auditEhrAccess({
    ctx,
    action: sentCount > 0 ? 'reengagement.outreach_sent' : 'reengagement.outreach_failed',
    resourceType: 'ehr_reengagement_campaign',
    resourceId: campaign.id,
    details: {
      sent_count: sentCount,
      failed_count: failedCount,
      requested: patientIds.length,
    },
  })

  return NextResponse.json({
    sent_count: sentCount,
    failed_count: failedCount,
    requested: patientIds.length,
  })
}
