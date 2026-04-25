// app/api/portal/consents/[id]/sign/route.ts — patient signs a pending consent.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getPortalSession } from '@/lib/ehr/portal'
import { auditEhrAccess } from '@/lib/ehr/audit'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getPortalSession()
  if (!session) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const name = (body?.signed_by_name || '').toString().trim()
  if (!name) return NextResponse.json({ error: 'Signed name required' }, { status: 400 })

  // Pull the consent; verify it belongs to this patient.
  const { data: consent } = await supabaseAdmin
    .from('ehr_consents').select('id, patient_id, practice_id, status')
    .eq('id', id).maybeSingle()
  if (!consent || consent.patient_id !== session.patient_id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  if (consent.status === 'signed') {
    return NextResponse.json({ error: 'Already signed' }, { status: 409 })
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || null

  const { data, error } = await supabaseAdmin
    .from('ehr_consents')
    .update({
      status: 'signed',
      signed_at: new Date().toISOString(),
      signed_by_name: name,
      signed_method: 'portal',
      signature_ip: ip,
    })
    .eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Audit as the system on behalf of the patient (no user.id available).
  await auditEhrAccess({
    user: { id: '00000000-0000-0000-0000-000000000000', email: `portal:${session.patient_id}` },
    practiceId: consent.practice_id,
    action: 'note.update',
    resourceId: id,
    details: { kind: 'consent', action: 'sign', via: 'portal', ip },
  })

  return NextResponse.json({ consent: data })
}
