// app/api/admin/reprovision/route.ts
//
// Wave 41 — re-provision an existing practice through the SignalWire +
// Retell stack. Replaces the Wave-23 Twilio + Vapi reprovisioning path
// (lib/twilio-provision + lib/vapi-provision are deleted in this wave).
//
// Routes through the canonical provisionPractice orchestrator
// (lib/aws/provisioning/provision-practice) so idempotency, audit
// rows, and rollback paths match every other carrier-side touchpoint.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase'
import { provisionPractice } from '@/lib/aws/provisioning/provision-practice'

export async function POST(req: NextRequest) {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user || user.email !== process.env.ADMIN_EMAIL) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { practice_id, area_code } = await req.json()
  if (!practice_id) {
    return NextResponse.json({ error: 'practice_id_required' }, { status: 400 })
  }

  const { data: p } = await supabaseAdmin
    .from('practices')
    .select('id, status, signalwire_number, retell_agent_id, name')
    .eq('id', practice_id)
    .single()
  if (!p) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Idempotency: a fully-provisioned practice short-circuits.
  if (p.status === 'active' && p.signalwire_number && p.retell_agent_id) {
    return NextResponse.json({ already: true, phone_number: p.signalwire_number })
  }

  try {
    const result = await provisionPractice({
      practiceId: practice_id,
      preferredAreaCode: area_code,
    })
    return NextResponse.json({
      success: true,
      phone_number: result.signalwirePhoneNumber,
      retell_agent_id: result.retellAgentId,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'reprovision_failed' }, { status: 500 })
  }
}
