// app/api/ehr/patients/[id]/part2-consents/[consentId]/revoke/route.ts
//
// Wave 41 — revoke a 42 CFR Part 2 consent. Sets revoked_at on the
// consent_signatures row. Disclosures already made are unaffected
// (consent revocation is forward-only).

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
import { PART2_KIND } from '@/lib/aws/ehr/part2'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; consentId: string }> },
) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  if (!ctx.practiceId) {
    return NextResponse.json({ error: 'practice_required' }, { status: 403 })
  }
  const { id: patientId, consentId } = await params

  // Confirm consent exists, belongs to this patient, this practice, and
  // is a 42_cfr_part2 signature.
  const { rows } = await pool.query(
    `SELECT s.id, s.revoked_at
       FROM consent_signatures s
       JOIN consent_documents d ON d.id = s.document_id
      WHERE s.id = $1
        AND s.patient_id = $2
        AND d.practice_id = $3
        AND d.kind = $4
      LIMIT 1`,
    [consentId, patientId, ctx.practiceId, PART2_KIND],
  )
  if (!rows.length) {
    return NextResponse.json({ error: 'consent_not_found' }, { status: 404 })
  }
  if (rows[0].revoked_at) {
    return NextResponse.json({ error: 'already_revoked' }, { status: 409 })
  }

  const upd = await pool.query(
    `UPDATE consent_signatures
        SET revoked_at = NOW(), revoked_by = $1
      WHERE id = $2
      RETURNING *`,
    [ctx.user.id, consentId],
  )

  await auditEhrAccess({
    ctx,
    action: 'part2_consent.revoke',
    resourceType: 'consent_signature',
    resourceId: consentId,
    details: { patient_id: patientId },
  })

  return NextResponse.json({ consent: upd.rows[0] })
}
