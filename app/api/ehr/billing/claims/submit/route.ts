// Batch-submit charges as claims to Stedi.
// Body: { charge_ids: string[] }   (max 50)
// Respects practices.stedi_mode — 'production' hits Stedi, anything else
// (default 'sandbox') synthesizes accepted responses without burning the API.
//
// Per-charge transactional persistence in lib/aws/stedi/claims so a partial
// batch failure doesn't leave inconsistent rows.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
import { submitClaimsForCharges } from '@/lib/aws/stedi/claims'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const body = await req.json().catch(() => null) as any
  const ids = Array.isArray(body?.charge_ids)
    ? body.charge_ids.filter((x: any) => typeof x === 'string')
    : []
  if (ids.length === 0) {
    return NextResponse.json({ error: 'charge_ids (array) required' }, { status: 400 })
  }
  if (ids.length > 50) {
    return NextResponse.json({ error: 'Max 50 charges per batch' }, { status: 400 })
  }

  const results = await submitClaimsForCharges({
    practiceId: ctx.practiceId!,
    chargeIds: ids,
  })

  await auditEhrAccess({
    ctx,
    action: 'billing.claims.submit',
    resourceType: 'ehr_claims_batch',
    details: {
      count: ids.length,
      submitted: results.filter(r => r.status === 'submitted').length,
      rejected: results.filter(r => r.status === 'rejected').length,
      errors: results.filter(r => r.status === 'error').length,
    },
  })

  return NextResponse.json({ results })
}
