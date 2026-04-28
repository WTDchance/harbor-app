// app/api/ehr/patients/duplicate-check/kept-separate/route.ts
//
// W44 T4 — therapist explicitly chose to create a new patient despite
// the warn / soft_warn verdict. Logs the decision so an audit pull
// can show the duplicate was reviewed and rejected (vs ignored).
//
// Body: { candidate_id, verdict: 'warn'|'soft_warn', reason? }

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const body = await req.json().catch(() => null)
  if (!body?.candidate_id) {
    return NextResponse.json({ error: 'candidate_id required' }, { status: 400 })
  }
  const verdict = ['warn', 'soft_warn'].includes(body.verdict) ? body.verdict : 'warn'
  const reason = body.reason ? String(body.reason).slice(0, 200) : null

  await auditEhrAccess({
    ctx,
    action: 'patient_duplicate.kept_separate',
    resourceType: 'patient',
    resourceId: String(body.candidate_id),
    details: {
      verdict,
      reason_provided: !!reason,
    },
  })

  return NextResponse.json({ ok: true })
}
