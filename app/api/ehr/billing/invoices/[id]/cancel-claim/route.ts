// app/api/ehr/billing/invoices/[id]/cancel-claim/route.ts
//
// Wave 41 / T5 patch — cancel a previously-adjudicated claim with
// the payer (CFC=8). Distinct from cancelling the underlying
// appointment; this is the formal void with the payer and is only
// valid when:
//   • The most-recent submission is in adjudication (PCCN assigned),
//     AND
//   • The payer is non-Medicare (Medicare won't accept CFC=8 on
//     professional/dental — must use CFC=1 corrected resubmission).
//
// Request body: { reason?: 'optional clinician note' } — required by
// internal policy in practice but not enforced here.

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

  let body: { reason?: string } = {}
  try {
    body = await req.json()
  } catch {
    body = {}
  }

  const outcome = await resubmitOrCancelClaim({
    practiceId: ctx.practiceId,
    invoiceId,
    submittedByUserId: ctx.user.id,
    mode: 'cancel',
    reason: body.reason,
  })

  if (!outcome.ok) {
    return NextResponse.json(
      { error: { code: 'cancel_failed', message: outcome.error }, issues: outcome.issues ?? [] },
      { status: outcome.status },
    )
  }

  await auditEhrAccess({
    ctx,
    action: 'claim.cancelled',
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
    cancelled: true,
  })
}
