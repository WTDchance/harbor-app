// app/api/ehr/billing/claims/submit/route.ts
// Batch-submit one or more charges as claims to Stedi.
// Body: { charge_ids: string[] }
// Respects practices.stedi_mode (sandbox | production).

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireEhrAuth, isAuthError } from '@/lib/ehr/auth'
import { auditEhrAccess } from '@/lib/ehr/audit'
import { submitClaimsForCharges } from '@/lib/ehr/stedi-claim'

export async function POST(req: NextRequest) {
  const auth = await requireEhrAuth(); if (isAuthError(auth)) return auth
  const body = await req.json().catch(() => null)
  const ids = Array.isArray(body?.charge_ids) ? body.charge_ids.filter((x: any) => typeof x === 'string') : []
  if (ids.length === 0) {
    return NextResponse.json({ error: 'charge_ids (array) required' }, { status: 400 })
  }
  if (ids.length > 50) {
    return NextResponse.json({ error: 'Max 50 charges per batch' }, { status: 400 })
  }

  const results = await submitClaimsForCharges({
    supabase: supabaseAdmin,
    practiceId: auth.practiceId,
    chargeIds: ids,
  })

  await auditEhrAccess({
    user: auth.user, practiceId: auth.practiceId, action: 'note.update',
    resourceId: 'batch',
    details: {
      kind: 'claim_submission_batch',
      count: ids.length,
      submitted: results.filter((r) => r.status === 'submitted').length,
      rejected: results.filter((r) => r.status === 'rejected').length,
      errors: results.filter((r) => r.status === 'error').length,
    },
    severity: 'warn',
  })

  return NextResponse.json({ results })
}
