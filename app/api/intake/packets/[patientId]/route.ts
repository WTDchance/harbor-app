// app/api/intake/packets/[patientId]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

/**
 * GET /api/intake/packets/[patientId]
 *
 * Returns intake progress for a patient. Strategy:
 *  1. If there's an intake_packets row, return it + its items (preferred).
 *  2. Else, synthesize a pseudo-packet from the latest intake_forms row so
 *     the UI immediately works with the existing send/submit pipeline.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { patientId: string } }
) {
  try {
    const patientId = params.patientId
    if (!patientId) return NextResponse.json({ error: 'missing patientId' }, { status: 400 })

    // 1. Try the new intake_packets table first.
    const { data: packet } = await supabaseAdmin
      .from('intake_packets')
      .select('*')
      .eq('patient_id', patientId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (packet) {
      const { data: items } = await supabaseAdmin
        .from('intake_packet_items')
        .select('*')
        .eq('packet_id', packet.id)
        .order('created_at', { ascending: true })
      return NextResponse.json({ packet, items: items ?? [] })
    }

    // 2. Fall back to intake_forms (current live pipeline).
    const { data: form } = await supabaseAdmin
      .from('intake_forms')
      .select('*')
      .eq('patient_id', patientId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!form) {
      return NextResponse.json({ packet: null, items: [] })
    }

    // Build a pseudo-packet that mirrors the intake_forms state.
    // intake_forms.status: 'pending' | 'sent' | 'opened' | 'completed'
    const isComplete = form.status === 'completed' || !!form.completed_at
    const isSent     = !!form.email_sent || !!form.sent_at || form.status !== 'pending'

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
  } catch (err: any) {
    console.error('[packets.GET]', err)
    return NextResponse.json({ error: err.message || 'internal error' }, { status: 500 })
  }
}
