// app/api/ehr/therapists/route.ts — list + update credentialing info.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireEhrAuth, isAuthError } from '@/lib/ehr/auth'
import { auditEhrAccess } from '@/lib/ehr/audit'

export async function GET() {
  const auth = await requireEhrAuth(); if (isAuthError(auth)) return auth
  const { data, error } = await supabaseAdmin
    .from('therapists')
    .select('id, display_name, credentials, is_primary, license_number, license_state, license_type, license_expires_at, npi, ceu_hours_ytd, ceu_required_yearly, ceu_cycle_ends_at, insurance_panels')
    .eq('practice_id', auth.practiceId)
    .order('display_name', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ therapists: data ?? [] })
}

const UPDATABLE = new Set([
  'license_number','license_state','license_type','license_expires_at',
  'npi','ceu_hours_ytd','ceu_required_yearly','ceu_cycle_ends_at','insurance_panels',
])

export async function PATCH(req: NextRequest) {
  const auth = await requireEhrAuth(); if (isAuthError(auth)) return auth
  const body = await req.json().catch(() => null)
  if (!body?.therapist_id) return NextResponse.json({ error: 'therapist_id required' }, { status: 400 })
  const patch: any = {}
  for (const [k, v] of Object.entries(body)) if (UPDATABLE.has(k)) patch[k] = v
  if (!Object.keys(patch).length) return NextResponse.json({ error: 'No updatable fields' }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from('therapists').update(patch).eq('id', body.therapist_id).eq('practice_id', auth.practiceId).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  await auditEhrAccess({
    user: auth.user, practiceId: auth.practiceId, action: 'note.update',
    resourceId: data.id, details: { kind: 'credentialing', fields: Object.keys(patch) },
  })
  return NextResponse.json({ therapist: data })
}
