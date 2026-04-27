// app/api/ehr/patients/[id]/disclosures/route.ts
//
// Wave 41 / T1 — list + create disclosure records.
// No DELETE — these are regulatory evidence per §164.528.

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

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id: patientId } = await params

  const { rows } = await pool.query(
    `SELECT r.*,
            COALESCE(u.full_name, u.email) AS disclosed_by_name
       FROM ehr_disclosure_records r
       LEFT JOIN users u ON u.id = r.disclosed_by_user_id
      WHERE r.practice_id = $1 AND r.patient_id = $2
      ORDER BY r.disclosed_at DESC
      LIMIT 200`,
    [ctx.practiceId, patientId],
  )

  await auditEhrAccess({
    ctx,
    action: 'disclosure.list',
    resourceType: 'ehr_disclosure_record_list',
    resourceId: patientId,
    details: { count: rows.length },
  })

  return NextResponse.json({ disclosures: rows })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id: patientId } = await params

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const kind = String(body.disclosure_kind ?? '')
  if (!VALID_KINDS.has(kind)) {
    return NextResponse.json(
      { error: { code: 'invalid_request', message: `disclosure_kind must be one of ${[...VALID_KINDS].join(', ')}` } },
      { status: 400 },
    )
  }
  const recipient_name = String(body.recipient_name ?? '').trim()
  const purpose = String(body.purpose ?? '').trim()
  const description_of_phi = String(body.description_of_phi ?? '').trim()
  if (!recipient_name || !purpose || !description_of_phi) {
    return NextResponse.json(
      { error: { code: 'invalid_request', message: 'recipient_name, purpose, and description_of_phi are required' } },
      { status: 400 },
    )
  }

  const disclosed_at = typeof body.disclosed_at === 'string' ? body.disclosed_at : new Date().toISOString()
  const recipient_address = typeof body.recipient_address === 'string' ? body.recipient_address : null
  const legal_authority = typeof body.legal_authority === 'string' ? body.legal_authority : null
  const consent_signature_id = typeof body.consent_signature_id === 'string' ? body.consent_signature_id : null
  const is_part2_protected = body.is_part2_protected === true
  const included_in_accounting = body.included_in_accounting !== false  // default TRUE
  const notes = typeof body.notes === 'string' ? body.notes : null

  const { rows } = await pool.query(
    `INSERT INTO ehr_disclosure_records
       (patient_id, practice_id, disclosed_by_user_id, disclosed_at,
        disclosure_kind, recipient_name, recipient_address, purpose,
        description_of_phi, legal_authority, consent_signature_id,
        is_part2_protected, included_in_accounting, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     RETURNING *`,
    [
      patientId, ctx.practiceId, ctx.user.id, disclosed_at,
      kind, recipient_name, recipient_address, purpose,
      description_of_phi, legal_authority, consent_signature_id,
      is_part2_protected, included_in_accounting, notes,
    ],
  )

  await auditEhrAccess({
    ctx,
    action: 'disclosure.create',
    resourceType: 'ehr_disclosure_record',
    resourceId: rows[0].id,
    details: {
      patient_id: patientId,
      disclosure_kind: kind,
      is_part2_protected,
      included_in_accounting,
    },
  })

  return NextResponse.json({ disclosure: rows[0] }, { status: 201 })
}
