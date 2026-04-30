// W52 D1 — send a document to a patient (or reception lead).
import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
import { renderTemplate, newSignatureToken } from '@/lib/ehr/esign'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CHANNELS = new Set(['email', 'sms', 'both'])

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id: patientId } = await params

  const body = await req.json().catch(() => null) as
    { template_id: string; delivery_channel?: string; recipient_email?: string; recipient_phone?: string } | null
  if (!body?.template_id) return NextResponse.json({ error: 'template_id_required' }, { status: 400 })

  const channel = CHANNELS.has(body.delivery_channel ?? '') ? body.delivery_channel : 'email'

  const p = await pool.query(
    `SELECT id, first_name, last_name, email, phone, date_of_birth
       FROM patients WHERE id = $1 AND practice_id = $2 LIMIT 1`,
    [patientId, ctx.practiceId],
  )
  if (p.rows.length === 0) return NextResponse.json({ error: 'patient_not_found' }, { status: 404 })
  const patient = p.rows[0]

  const t = await pool.query(
    `SELECT id, name, category, body_html, variables FROM practice_document_templates
      WHERE id = $1 AND practice_id = $2 AND status = 'active' LIMIT 1`,
    [body.template_id, ctx.practiceId],
  )
  if (t.rows.length === 0) return NextResponse.json({ error: 'template_not_found' }, { status: 404 })
  const template = t.rows[0]

  const rendered = renderTemplate(template.body_html, {
    patient_first_name: patient.first_name,
    patient_last_name: patient.last_name,
    patient_full_name: [patient.first_name, patient.last_name].filter(Boolean).join(' '),
    patient_dob: patient.date_of_birth,
    patient_email: patient.email,
    patient_phone: patient.phone,
    practice_id: ctx.practiceId ?? '',
    today: new Date().toISOString().slice(0, 10),
  })

  const token = newSignatureToken()
  const ins = await pool.query(
    `INSERT INTO document_signature_requests
       (practice_id, patient_id, template_id, rendered_body_html,
        recipient_email, recipient_phone, delivery_channel, portal_token, sent_by_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, portal_token, status, expires_at`,
    [
      ctx.practiceId, patientId, template.id, rendered,
      body.recipient_email ?? patient.email,
      body.recipient_phone ?? patient.phone,
      channel, token, ctx.user.id,
    ],
  )

  await auditEhrAccess({
    ctx, action: 'document.sent' as any, resourceType: 'document_signature_request',
    resourceId: ins.rows[0].id,
    severity: 'info',
    details: { patient_id: patientId, category: template.category, channel },
  })

  // Best-effort delivery — production wires this to Resend/SES + SignalWire SMS.
  // For now we return the portal URL; the practice can paste it into messages.
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')
  return NextResponse.json({
    request: ins.rows[0],
    portal_url: `${base}/portal/sign/${token}`,
  }, { status: 201 })
}
