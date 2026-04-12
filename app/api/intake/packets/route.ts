// app/api/intake/packets/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

// Default starter packet for new patients
const DEFAULT_PACKET_ITEMS = [
  { document_type: 'intake_form',    document_title: 'New Patient Intake Form' },
  { document_type: 'hipaa_notice',   document_title: 'HIPAA Notice of Privacy Practices' },
  { document_type: 'informed_consent', document_title: 'Informed Consent for Treatment' },
  { document_type: 'phq9',           document_title: 'PHQ-9 Depression Screening' },
  { document_type: 'gad7',           document_title: 'GAD-7 Anxiety Screening' },
]

/**
 * POST /api/intake/packets
 * Body: { patient_id, practice_id, call_log_id?, items? }
 * Creates a new intake packet for a patient with starter items.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { patient_id, call_log_id, items } = body
    let { practice_id } = body
    if (!patient_id) {
      return NextResponse.json({ error: 'patient_id required' }, { status: 400 })
    }

    // Auto-resolve practice_id from patient if not provided
    if (!practice_id) {
      const { data: patient } = await supabaseAdmin
        .from('patients')
        .select('practice_id')
        .eq('id', patient_id)
        .single()
      if (!patient?.practice_id) {
        return NextResponse.json({ error: 'Could not resolve practice for this patient' }, { status: 404 })
      }
      practice_id = patient.practice_id
    }

    const { data: packet, error: packetErr } = await supabaseAdmin
      .from('intake_packets')
      .insert({ patient_id, practice_id, call_log_id: call_log_id ?? null })
      .select()
      .single()
    if (packetErr) throw packetErr

    const itemsToInsert = (Array.isArray(items) && items.length > 0 ? items : DEFAULT_PACKET_ITEMS)
      .map((it: any) => ({
        packet_id: packet.id,
        practice_id,
        patient_id,
        document_type: it.document_type,
        document_title: it.document_title,
        status: 'pending',
      }))

    const { error: itemsErr } = await supabaseAdmin
      .from('intake_packet_items')
      .insert(itemsToInsert)
    if (itemsErr) throw itemsErr

    return NextResponse.json({ packet_id: packet.id, item_count: itemsToInsert.length })
  } catch (err: any) {
    console.error('[packets.POST]', err)
    return NextResponse.json({ error: err.message || 'internal error' }, { status: 500 })
  }
}
