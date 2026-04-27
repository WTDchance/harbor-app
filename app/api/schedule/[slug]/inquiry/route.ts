// app/api/schedule/[slug]/inquiry/route.ts
//
// Wave 42 / T1 — public new-patient inquiry. Unauthenticated POST
// from /schedule/<practice_slug>.
//
// In PUBLIC_API_PREFIXES so the middleware doesn't gate it. Rate-
// limit + abuse forensics: stamp source_ip + source_user_agent on
// the row. Validate practice exists and scheduling_config.enabled +
// .allow_new_patient_inquiry both true.

import { NextResponse, type NextRequest } from 'next/server'
import { pool } from '@/lib/aws/db'
import { auditSystemEvent } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  const ua = req.headers.get('user-agent') ?? null

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const inquirerName = String(body.inquirer_name ?? '').trim()
  const inquirerEmail = typeof body.inquirer_email === 'string' ? body.inquirer_email.trim() : null
  const inquirerPhone = typeof body.inquirer_phone === 'string' ? body.inquirer_phone.trim() : null
  if (!inquirerName) {
    return NextResponse.json(
      { error: { code: 'invalid_request', message: 'inquirer_name required' } },
      { status: 400 },
    )
  }
  if (!inquirerEmail && !inquirerPhone) {
    return NextResponse.json(
      { error: { code: 'invalid_request', message: 'inquirer_email or inquirer_phone required' } },
      { status: 400 },
    )
  }

  const reason = typeof body.reason === 'string' ? body.reason : null
  const visitTypeKey = typeof body.visit_type_key === 'string' ? body.visit_type_key : null
  const preferredWindows = Array.isArray(body.preferred_windows) ? body.preferred_windows : null

  // Load practice + config; gate on enabled + allow_new_patient_inquiry.
  const pr = await pool.query(
    `SELECT id, scheduling_config FROM practices WHERE slug = $1 LIMIT 1`,
    [slug],
  )
  const practice = pr.rows[0]
  if (!practice) {
    return NextResponse.json({ error: 'Practice not found' }, { status: 404 })
  }
  const cfg = practice.scheduling_config ?? {}
  if (!cfg.enabled || !cfg.allow_new_patient_inquiry) {
    return NextResponse.json(
      {
        error: {
          code: 'inquiry_disabled',
          message: 'This practice does not currently accept new-patient inquiries via the public scheduling page.',
        },
      },
      { status: 409 },
    )
  }

  const { rows } = await pool.query(
    `INSERT INTO ehr_new_patient_inquiries
       (practice_id, inquirer_name, inquirer_email, inquirer_phone,
        reason, visit_type_key, preferred_windows,
        source_ip, source_user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::inet, $9)
     RETURNING id`,
    [
      practice.id, inquirerName, inquirerEmail, inquirerPhone,
      reason, visitTypeKey,
      preferredWindows ? JSON.stringify(preferredWindows) : null,
      ip, ua,
    ],
  )

  await auditSystemEvent({
    action: 'public.scheduling.inquiry',
    severity: 'info',
    practiceId: practice.id,
    resourceType: 'ehr_new_patient_inquiry',
    resourceId: rows[0].id,
    details: {
      // No PHI in details — name/email are flagged as PHI by the
      // sanitizer, so we record only structural metadata.
      visit_type_key: visitTypeKey,
      has_email: !!inquirerEmail,
      has_phone: !!inquirerPhone,
      ip,
    },
  })

  return NextResponse.json({ ok: true, inquiry_id: rows[0].id }, { status: 201 })
}
