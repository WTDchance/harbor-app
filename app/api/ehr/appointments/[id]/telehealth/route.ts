// app/api/ehr/appointments/[id]/telehealth/route.ts
// Generates (or returns existing) a unique telehealth room slug for the
// appointment. Returns the full joinable URL.
//
// Provider for v1: Jitsi Meet (https://meet.jit.si) — no account, no setup.
// HIPAA note: Jitsi public rooms are NOT BAA-backed. For real patient use
// you should replace the provider with Doxy.me, Daily.co (BAA plan), or
// self-hosted Jitsi. The shape of this route doesn't change — only the
// URL template below.

import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase'
import { requireEhrAuth, isAuthError } from '@/lib/ehr/auth'
import { auditEhrAccess } from '@/lib/ehr/audit'

const PROVIDER_URL = 'https://meet.jit.si/' // swap for BAA-backed provider in prod

function newSlug(): string {
  return 'harbor-' + randomBytes(9).toString('base64url')
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireEhrAuth(); if (isAuthError(auth)) return auth
  const { id } = await params

  const { data: appt } = await supabaseAdmin
    .from('appointments')
    .select('id, practice_id, patient_id, telehealth_room_slug')
    .eq('id', id)
    .eq('practice_id', auth.practiceId)
    .maybeSingle()
  if (!appt) return NextResponse.json({ error: 'Appointment not found' }, { status: 404 })

  let slug = appt.telehealth_room_slug
  if (!slug) {
    slug = newSlug()
    const { error } = await supabaseAdmin
      .from('appointments').update({ telehealth_room_slug: slug }).eq('id', id).eq('practice_id', auth.practiceId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const url = PROVIDER_URL + slug

  await auditEhrAccess({
    user: auth.user, practiceId: auth.practiceId,
    action: 'note.view', // treat as view-level PHI context; refine enum later
    resourceId: id,
    details: { kind: 'telehealth_link', created_or_reused: !appt.telehealth_room_slug ? 'created' : 'reused' },
  })

  return NextResponse.json({ slug, url, provider: 'jitsi_public' })
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireEhrAuth(); if (isAuthError(auth)) return auth
  const { id } = await params
  const { data: appt } = await supabaseAdmin
    .from('appointments').select('telehealth_room_slug').eq('id', id).eq('practice_id', auth.practiceId).maybeSingle()
  if (!appt?.telehealth_room_slug) return NextResponse.json({ slug: null, url: null })
  return NextResponse.json({
    slug: appt.telehealth_room_slug,
    url: PROVIDER_URL + appt.telehealth_room_slug,
    provider: 'jitsi_public',
  })
}
