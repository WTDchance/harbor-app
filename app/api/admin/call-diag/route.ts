// app/api/admin/call-diag/route.ts
//
// Wave 41 — call pipeline diagnostic. Vapi blocks removed; the route now
// returns DB-side state only (call_logs, intake_forms, patients) plus a
// Retell snapshot for practices that have been provisioned through the
// SignalWire+Retell stack. The legacy POST `fix-phone-server-url` action
// (which patched a Vapi phone-number record) is replaced by a 410 — the
// equivalent fix for Retell is to re-import the SignalWire number via
// /api/admin/reprovision.
//
// Auth: Bearer ${CRON_SECRET}
// GET  /api/admin/call-diag?practice_id=<uuid>

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { auditSystemEvent } from '@/lib/aws/ehr/audit'

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') || ''
  const expected = `Bearer ${process.env.CRON_SECRET || ''}`
  if (!process.env.CRON_SECRET || auth !== expected) return unauthorized()

  const practiceId = req.nextUrl.searchParams.get('practice_id')
  if (!practiceId) {
    return NextResponse.json({ error: 'practice_id required' }, { status: 400 })
  }

  const { data: calls, error: callErr } = await supabaseAdmin
    .from('call_logs')
    .select('*')
    .eq('practice_id', practiceId)
    .order('created_at', { ascending: false })
    .limit(10)

  const { data: intakes, error: intakeErr } = await supabaseAdmin
    .from('intake_forms')
    .select('*')
    .eq('practice_id', practiceId)
    .order('created_at', { ascending: false })
    .limit(10)

  const { data: patients, error: patErr } = await supabaseAdmin
    .from('patients')
    .select('id, first_name, last_name, phone, email, created_at')
    .eq('practice_id', practiceId)
    .order('created_at', { ascending: false })
    .limit(10)

  // Retell agent snapshot (replaces the legacy Vapi assistant block)
  let retellAgent: any = null
  const { data: practice } = await supabaseAdmin
    .from('practices')
    .select('retell_agent_id, signalwire_number, signalwire_phone_sid')
    .eq('id', practiceId)
    .single()

  if ((practice as any)?.retell_agent_id && process.env.RETELL_API_KEY) {
    try {
      const r = await fetch(`https://api.retellai.com/get-agent/${(practice as any).retell_agent_id}`, {
        headers: { Authorization: `Bearer ${process.env.RETELL_API_KEY}` },
      })
      if (r.ok) {
        const a = await r.json()
        retellAgent = {
          agent_id: a.agent_id,
          agent_name: a.agent_name,
          response_engine: a.response_engine,
          voice_id: a.voice_id,
          inbound_dynamic_variables_webhook_url: a.inbound_dynamic_variables_webhook_url,
        }
      }
    } catch { /* swallow */ }
  }

  return NextResponse.json({
    call_logs: { data: calls, error: callErr?.message },
    intake_forms: { data: intakes, error: intakeErr?.message },
    patients: { data: patients, error: patErr?.message },
    retell_agent: retellAgent,
    signalwire_number: (practice as any)?.signalwire_number ?? null,
    signalwire_phone_sid: (practice as any)?.signalwire_phone_sid ?? null,
  })
}

// POST `fix-phone-server-url` was Vapi-specific. The SignalWire+Retell
// equivalent is to re-import the number; tell ops to use reprovision.
export async function POST(req: NextRequest) {
  await auditSystemEvent({
    action: 'vapi.call_diag_fix.deprecated_hit',
    severity: 'warn',
    details: { ua: req.headers.get('user-agent') ?? null },
  }).catch(() => {})

  return NextResponse.json(
    {
      error: 'gone',
      reason: 'vapi_retired_wave_41',
      replacement: '/api/admin/reprovision',
      docs: 'The fix-phone-server-url action patched a Vapi phone record. Vapi is retired; the SignalWire+Retell equivalent is to re-run /api/admin/reprovision { practice_id }.',
    },
    { status: 410 },
  )
}
