// app/api/portal/insurance-card/confirm/route.ts
//
// W44 T6 — patient confirms the parsed fields are correct. Updates
// the scan row's confidence to 1.0 if the patient confirmed the values
// unchanged; otherwise stores the patient-corrected values as the
// scan_data and confidence at 1.0 for those keys.
//
// We do NOT update the patient row's insurance_* columns from this
// endpoint — therapist-side review remains the gate before the chart
// is mutated. Confirming is a hint for the therapist that the patient
// vouches for the data.

import { NextResponse, type NextRequest } from 'next/server'
import { requirePortalSession } from '@/lib/aws/portal-auth'
import { auditPortalAccess } from '@/lib/aws/ehr/audit'
import { pool } from '@/lib/aws/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const sess = await requirePortalSession()
  if (sess instanceof NextResponse) return sess

  const body = await req.json().catch(() => null)
  if (!body?.scan_id) {
    return NextResponse.json({ error: 'scan_id required' }, { status: 400 })
  }
  const corrections: Record<string, string> = (body.corrections && typeof body.corrections === 'object')
    ? body.corrections : {}

  // Verify the scan belongs to this patient + was patient-uploaded.
  const cur = await pool.query(
    `SELECT scan_data, field_confidence
       FROM ehr_insurance_card_scans
      WHERE id = $1 AND patient_id = $2 AND practice_id = $3
        AND scanned_by_role = 'patient'
      LIMIT 1`,
    [body.scan_id, sess.patientId, sess.practiceId],
  )
  if (cur.rows.length === 0) {
    return NextResponse.json({ error: 'scan_not_found' }, { status: 404 })
  }

  const existingData = (cur.rows[0].scan_data || {}) as Record<string, string>
  const existingConf = (cur.rows[0].field_confidence || {}) as Record<string, number>
  const newData = { ...existingData }
  const newConf = { ...existingConf }
  for (const [k, v] of Object.entries(corrections)) {
    if (typeof v === 'string' && v.length <= 200) {
      newData[k] = v
      newConf[k] = 1.0  // patient-confirmed
    }
  }
  // For keys that already existed and weren't corrected, also bump
  // their confidence to 1.0 since the patient saw them and didn't
  // override.
  for (const k of Object.keys(existingData)) {
    if (!(k in corrections)) newConf[k] = 1.0
  }

  await pool.query(
    `UPDATE ehr_insurance_card_scans
        SET scan_data = $1::jsonb,
            field_confidence = $2::jsonb,
            confidence = 1.0
      WHERE id = $3`,
    [JSON.stringify(newData), JSON.stringify(newConf), body.scan_id],
  )

  await auditPortalAccess({
    session: sess,
    action: 'portal.insurance_card.confirmed',
    resourceType: 'insurance_card_scan',
    resourceId: body.scan_id,
    details: {
      corrections_count: Object.keys(corrections).length,
      total_fields: Object.keys(newData).length,
    },
  })

  return NextResponse.json({ ok: true })
}
