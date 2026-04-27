// app/api/admin/provision-practice/route.ts
//
// Wave 29 — Admin-triggered practice provisioning. Manual entry point
// for re-running provisioning on a practice (e.g. after a failed
// auto-trigger from the Stripe webhook). Also used for testing.
//
// POST { practice_id: string, preferred_area_code?: string }
//   → 200 { practice_id, signalwire_phone_number, retell_agent_id, ... }

import { NextRequest, NextResponse } from 'next/server'
import { requireAdminSession } from '@/lib/aws/api-auth'
import { provisionPractice } from '@/lib/aws/provisioning/provision-practice'
import { hashAdminPayload } from '@/lib/aws/admin/payload-hash'
import { auditSystemEvent } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const ctx = await requireAdminSession()
  if (ctx instanceof NextResponse) return ctx

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const practiceId: string | undefined = body?.practice_id
  const preferredAreaCode: string | undefined = body?.preferred_area_code
  if (!practiceId) {
    return NextResponse.json({ error: 'practice_id_required' }, { status: 400 })
  }

  await auditSystemEvent({
    action: 'admin.provision_practice.invoked',
    severity: 'info',
    practiceId,
    details: {
      payload_sha256: hashAdminPayload(body),
      preferred_area_code: preferredAreaCode || null,
      admin_email: ctx.session.email,
    },
  })

  try {
    const result = await provisionPractice({
      practiceId,
      preferredAreaCode,
    })
    return NextResponse.json({
      ok: true,
      practice_id: result.practiceId,
      signalwire_phone_number: result.signalwirePhoneNumber,
      signalwire_phone_sid: result.signalwirePhoneSid,
      retell_agent_id: result.retellAgentId,
      retell_llm_id: result.retellLlmId,
    })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    )
  }
}
