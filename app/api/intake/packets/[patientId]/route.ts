// Intake progress for a patient. Two-tier: prefer intake_packets row;
// fall back to a synthesized pseudo-packet from intake_forms so the UI
// keeps working while the new packets table backfills.

import { NextResponse, type NextRequest } from 'next/server'
import { requireApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ patientId: string }> },
) {
  const ctx = await requireApiSession()
  if (ctx instanceof NextResponse) return ctx

  const { patientId } = await params
  if (!patientId) return NextResponse.json({ error: 'missing patientId' }, { status: 400 })

  // 1. Real intake_packets row.
  try {
    const packetRow = await pool.query(
      `SELECT * FROM intake_packets
        WHERE patient_id = $1
        ORDER BY created_at DESC LIMIT 1`,
      [patientId],
    )
    const packet = packetRow.rows[0]
    if (packet) {
      const itemsRow = await pool.query(
        `SELECT * FROM intake_packet_items
          WHERE packet_id = $1
          ORDER BY created_at ASC`,
        [packet.id],
      )
      return NextResponse.json({ packet, items: itemsRow.rows })
    }
  } catch { /* table may not exist on this cluster — fall through */ }

  // 2. Fallback pseudo-packet from intake_forms.
  const formRow = await pool.query(
    `SELECT * FROM intake_forms
      WHERE patient_id = $1
      ORDER BY created_at DESC LIMIT 1`,
    [patientId],
  ).catch(() => ({ rows: [] as any[] }))
  const form = formRow.rows[0]
  if (!form) return NextResponse.json({ packet: null, items: [] })

  const isComplete = form.status === 'completed' || !!form.completed_at
  const isSent = !!form.email_sent || !!form.sent_at || form.status !== 'pending'

  const pseudoPacket = {
    id: form.id,
    status: isComplete ? 'complete' : isSent ? 'partial' : 'pending',
    total_items: 1,
    completed_items: isComplete ? 1 : 0,
    last_reminder_at: form.last_reminder_at ?? null,
    reminder_count: form.reminder_count ?? 0,
    created_at: form.created_at,
    _source: 'intake_forms',
  }
  const pseudoItems = [{
    id: form.id,
    document_type: 'intake_form',
    document_title: 'New Patient Intake Form',
    status: isComplete ? 'completed' : isSent ? 'sent' : 'pending',
    sent_at: form.email_sent_at ?? null,
    opened_at: null,
    completed_at: form.completed_at ?? null,
    reminder_count: form.reminder_count ?? 0,
    last_reminder_at: form.last_reminder_at ?? null,
  }]
  return NextResponse.json({ packet: pseudoPacket, items: pseudoItems })
}
