// Create a new intake packet for a patient with starter items.
// Therapist-side, requireApiSession (Cognito).

import { NextResponse, type NextRequest } from 'next/server'
import { requireApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DEFAULT_PACKET_ITEMS = [
  { document_type: 'intake_form',      document_title: 'New Patient Intake Form' },
  { document_type: 'hipaa_notice',     document_title: 'HIPAA Notice of Privacy Practices' },
  { document_type: 'informed_consent', document_title: 'Informed Consent for Treatment' },
  { document_type: 'phq9',             document_title: 'PHQ-9 Depression Screening' },
  { document_type: 'gad7',             document_title: 'GAD-7 Anxiety Screening' },
]

export async function POST(req: NextRequest) {
  const ctx = await requireApiSession()
  if (ctx instanceof NextResponse) return ctx

  const body = await req.json().catch(() => null) as any
  const { patient_id, call_log_id, items } = body ?? {}
  let { practice_id } = body ?? {}
  if (!patient_id) return NextResponse.json({ error: 'patient_id required' }, { status: 400 })

  if (!practice_id) {
    const r = await pool.query(
      `SELECT practice_id FROM patients WHERE id = $1 LIMIT 1`, [patient_id],
    ).catch(() => ({ rows: [] as any[] }))
    practice_id = r.rows[0]?.practice_id
    if (!practice_id) {
      return NextResponse.json({ error: 'Could not resolve practice for this patient' }, { status: 404 })
    }
  }

  // Two-table write — small, but transactional so a failed items insert
  // doesn't leave an empty packet row.
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows: packetRows } = await client.query(
      `INSERT INTO intake_packets (patient_id, practice_id, call_log_id)
       VALUES ($1, $2, $3) RETURNING *`,
      [patient_id, practice_id, call_log_id ?? null],
    )
    const packet = packetRows[0]

    const itemsToInsert = (Array.isArray(items) && items.length > 0 ? items : DEFAULT_PACKET_ITEMS)
    for (const it of itemsToInsert) {
      await client.query(
        `INSERT INTO intake_packet_items (
           packet_id, practice_id, patient_id,
           document_type, document_title, status
         ) VALUES ($1, $2, $3, $4, $5, 'pending')`,
        [packet.id, practice_id, patient_id, it.document_type, it.document_title],
      )
    }
    await client.query('COMMIT')
    return NextResponse.json({ packet_id: packet.id, item_count: itemsToInsert.length })
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    return NextResponse.json(
      { error: (err as Error).message || 'internal error' },
      { status: 500 },
    )
  } finally {
    client.release()
  }
}
