// app/api/ehr/patients/[id]/disclosures/[disclosureId]/route.ts
//
// Wave 41 / T1 — fetch + update one disclosure record.
// No DELETE — these are regulatory evidence per §164.528.
// Updates are allowed for typo fixes / address corrections; every
// change writes its own audit row.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const VALID_KINDS = new Set([
  'roi_authorization', 'court_order', 'public_health',
  'law_enforcement', 'workers_comp', 'coroner_or_funeral',
  'research', 'oversight_agency', 'tarasoff_warning', 'other',
])

const UPDATABLE_TEXT = [
  'recipient_name', 'recipient_address', 'purpose',
  'description_of_phi', 'legal_authority', 'notes',
] as const

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; disclosureId: string }> },
) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id: patientId, disclosureId } = await params

  const { rows } = await pool.query(
    `SELECT r.*, COALESCE(u.full_name, u.email) AS disclosed_by_name
       FROM ehr_disclosure_records r
       LEFT JOIN users u ON u.id = r.disclosed_by_user_id
      WHERE r.practice_id = $1 AND r.patient_id = $2 AND r.id = $3
      LIMIT 1`,
    [ctx.practiceId, patientId, disclosureId],
  )
  if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await auditEhrAccess({
    ctx,
    action: 'disclosure.view',
    resourceType: 'ehr_disclosure_record',
    resourceId: disclosureId,
    details: { patient_id: patientId },
  })

  return NextResponse.json({ disclosure: rows[0] })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; disclosureId: string }> },
) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id: patientId, disclosureId } = await params

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const sets: string[] = []
  const args: unknown[] = []

  for (const k of UPDATABLE_TEXT) {
    if (k in body) {
      args.push(body[k] == null ? null : String(body[k]))
      sets.push(`${k} = $${args.length}`)
    }
  }
  if ('disclosure_kind' in body) {
    const k = String(body.disclosure_kind)
    if (!VALID_KINDS.has(k)) {
      return NextResponse.json({ error: { code: 'invalid_request', message: 'invalid disclosure_kind' } }, { status: 400 })
    }
    args.push(k); sets.push(`disclosure_kind = $${args.length}`)
  }
  if (typeof body.disclosed_at === 'string') {
    args.push(body.disclosed_at); sets.push(`disclosed_at = $${args.length}`)
  }
  if (typeof body.is_part2_protected === 'boolean') {
    args.push(body.is_part2_protected); sets.push(`is_part2_protected = $${args.length}`)
  }
  if (typeof body.included_in_accounting === 'boolean') {
    args.push(body.included_in_accounting); sets.push(`included_in_accounting = $${args.length}`)
  }
  if ('consent_signature_id' in body) {
    args.push(body.consent_signature_id == null ? null : String(body.consent_signature_id))
    sets.push(`consent_signature_id = $${args.length}`)
  }

  if (sets.length === 0) {
    return NextResponse.json({ error: 'no fields to update' }, { status: 400 })
  }

  args.push(ctx.practiceId, patientId, disclosureId)
  const { rows } = await pool.query(
    `UPDATE ehr_disclosure_records
        SET ${sets.join(', ')}
      WHERE practice_id = $${args.length - 2}
        AND patient_id  = $${args.length - 1}
        AND id          = $${args.length}
      RETURNING *`,
    args,
  )
  if (!rows[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await auditEhrAccess({
    ctx,
    action: 'disclosure.update',
    resourceType: 'ehr_disclosure_record',
    resourceId: disclosureId,
    details: {
      patient_id: patientId,
      fields_changed: sets.map((s) => s.split(' ')[0]),
    },
  })

  return NextResponse.json({ disclosure: rows[0] })
}
