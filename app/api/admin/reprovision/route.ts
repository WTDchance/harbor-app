import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase'
import { purchaseTwilioNumber, releaseTwilioNumber } from '@/lib/twilio-provision'
import { createVapiAssistant, linkVapiPhoneNumber, deleteVapiAssistant } from '@/lib/vapi-provision'

export async function POST(req: NextRequest) {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user || user.email !== process.env.ADMIN_EMAIL) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { practice_id } = await req.json()
  const { data: p } = await supabaseAdmin
    .from('practices').select('*').eq('id', practice_id).single()
  if (!p) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (p.status === 'active' && p.phone_number) {
    return NextResponse.json({ already: true, phone_number: p.phone_number })
  }
  let sid: string | null = null
  let num: string | null = null
  let aid: string | null = null
  let pid: string | null = null
  try {
    const t = await purchaseTwilioNumber({
      state: p.state, friendlyName: 'Harbor - ' + p.name,
    })
    sid = t.sid
    num = t.phoneNumber
    aid = await createVapiAssistant({
      id: p.id, name: p.name, providerName: p.provider_name,
      aiName: p.ai_name || 'Ellie', greeting: p.greeting,
      specialties: p.specialties, insuranceAccepted: p.insurance_accepted,
      location: p.location, telehealth: p.telehealth, timezone: p.timezone,
    })
    pid = await linkVapiPhoneNumber({
      assistantId: aid, twilioPhoneNumber: num, practiceName: p.name,
    })
    await supabaseAdmin.from('practices').update({
      status: 'active', subscription_status: 'active',
      phone_number: num, twilio_phone_sid: sid,
      vapi_assistant_id: aid, vapi_phone_number_id: pid,
      provisioned_at: new Date().toISOString(), provisioning_error: null,
    }).eq('id', practice_id)
    return NextResponse.json({ success: true, phone_number: num })
  } catch (e: any) {
    if (sid) releaseTwilioNumber(sid).catch(() => {})
    if (aid) deleteVapiAssistant(aid).catch(() => {})
    return NextResponse.json({ error: e?.message }, { status: 500 })
  }
}
