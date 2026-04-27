// app/api/ehr/insurance-authorizations/check/route.ts
//
// Wave 40 / P1 — pre-flight check. The appointment-creation UI calls
// this with { patient_id, cpt_code, scheduled_for } to surface
// authorization warnings before submitting. No DB writes.
//
// This route is the read-only counterpart to the auto-consume that
// happens server-side in POST /api/ehr/appointments.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { findActiveAuth, computeWarning } from '@/lib/aws/ehr/authorizations'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const patientId = typeof body.patient_id === 'string' ? body.patient_id : ''
  const scheduledFor = typeof body.scheduled_for === 'string' ? body.scheduled_for : ''
  const cptCode = typeof body.cpt_code === 'string' ? body.cpt_code : null
  if (!patientId || !scheduledFor) {
    return NextResponse.json(
      { error: { code: 'invalid_request', message: 'patient_id and scheduled_for required' } },
      { status: 400 },
    )
  }

  const auth = await findActiveAuth({
    practiceId: ctx.practiceId!,
    patientId,
    cptCode,
    scheduledFor,
  })
  const { warning, message } = computeWarning(auth, scheduledFor)

  return NextResponse.json({
    auth: auth ? {
      id: auth.id,
      payer: auth.payer,
      auth_number: auth.auth_number,
      sessions_authorized: auth.sessions_authorized,
      sessions_used: auth.sessions_used,
      valid_from: auth.valid_from,
      valid_to: auth.valid_to,
      cpt_codes_covered: auth.cpt_codes_covered,
      status: auth.status,
    } : null,
    warning,
    message,
  })
}
