// app/api/ehr/billing/invoices/[id]/resubmit-claim/route.ts
//
// Wave 41 / T5 patch — corrected/replacement claim resubmission.
// CFC=1 (pre-adj or Medicare adjudication, reuse PCN, no PCCN) or
// CFC=7 (non-Medicare adjudication, NEW PCN, include PCCN). Logic
// lives in lib/ehr/stedi-resubmit.ts; this route is the HTTP wrapper
// + audit hook.
//
// Request body:
//   { corrections?: { ...claimInformation overrides... },
//     reason?: 'optional clinician note' }
//
// On success:
//   { submission: <new ehr_claim_submissions row>, cfc, pcn, pccn,
//     is_medicare, is_in_adjudication }

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
import { resubmitOrCancelClaim } from '@/lib/ehr/stedi-resubmit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  if (!ctx.practiceId) return NextResponse.json({ error: 'no_practice' }, { status: 403 })
  const { id: invoiceId } = await params

  let body: { corrections?: Record<string, unknown>; reason?: string } = {}
  try {
    body = await req.json()
  } catch {
    body = {}
  }

  const outcome = await resubmitOrCancelClaim({
    practiceId: ctx.practiceId,
    invoiceId,
    submittedByUserId: ctx.user.id,
    mode: 'replace',
    corrections: body.corrections,
    reason: body.reason,
  })

  if (!outcome.ok) {
    return NextResponse.json(
      { error: { code: 'resubmit_failed', message: outcome.error }, issues: outcome.issues ?? [] },
      { status: outcome.status },
    )
  }

  await auditEhrAccess({
    ctx,
    action: 'claim.resubmitted',
    resourceType: 'ehr_claim_submission',
    resourceId: outcome.submission.id,
    details: {
      invoice_id: invoiceId,
      cfc: outcome.cfc,
      pcn: outcome.pcn,
      pccn: outcome.pccn,
      is_medicare: outcome.isMedicare,
      is_in_adjudication: outcome.isInAdjudication,
      original_submission_id: outcome.submission.original_submission_id,
      reason: body.reason ?? null,
    },
  })

  return NextResponse.json({
    submission: outcome.submission,
    cfc: outcome.cfc,
    pcn: outcome.pcn,
    pccn: outcome.pccn,
    is_medicare: outcome.isMedicare,
    is_in_adjudication: outcome.isInAdjudication,
  })
}
