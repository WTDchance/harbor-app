// app/api/ehr/preferences/route.ts
// Read + update the practice's ui_preferences.
//
// Admin-only for PATCH (the practice owner decides the shape of the
// product for everyone else). Reading is open to any practice user —
// the UI needs it to decide what to render.

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireEhrAuth, isAuthError } from '@/lib/ehr/auth'
import { auditEhrAccess } from '@/lib/ehr/audit'
import { normalize, findPreset, type PracticeScale, type MetricsDepth } from '@/lib/ehr/preferences'

export async function GET() {
  const auth = await requireEhrAuth(); if (isAuthError(auth)) return auth
  const { data } = await supabaseAdmin
    .from('practices').select('ui_preferences').eq('id', auth.practiceId).maybeSingle()
  return NextResponse.json({ preferences: normalize(data?.ui_preferences) })
}

export async function PATCH(req: NextRequest) {
  const auth = await requireEhrAuth(); if (isAuthError(auth)) return auth
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Permission check — only practice admin or the Harbor admin email can
  // modify. Defense in depth: if users table doesn't identify an admin,
  // we fall back to the hardcoded admin email override.
  const isAdminEmail = (auth.user.email || '').toLowerCase() === (process.env.ADMIN_EMAIL || 'chancewonser@gmail.com').toLowerCase()
  let canEdit = isAdminEmail
  if (!canEdit) {
    const { data: userRow } = await supabaseAdmin
      .from('users').select('role').eq('id', auth.user.id).eq('practice_id', auth.practiceId).maybeSingle()
    canEdit = userRow?.role === 'admin'
  }
  if (!canEdit) {
    return NextResponse.json({ error: 'Only a practice admin can change these settings.' }, { status: 403 })
  }

  const { data: current } = await supabaseAdmin
    .from('practices').select('ui_preferences').eq('id', auth.practiceId).maybeSingle()
  let next = normalize(current?.ui_preferences)

  // Preset application — if scale + metrics_depth change, look up the preset
  // and use it as the new baseline.
  if (body.apply_preset && body.scale && body.metrics_depth) {
    const preset = findPreset(body.scale as PracticeScale, body.metrics_depth as MetricsDepth)
    if (preset) next = { ...preset.prefs }
  } else {
    if (body.scale === 'solo' || body.scale === 'small' || body.scale === 'large') next.scale = body.scale
    if (body.metrics_depth === 'minimal' || body.metrics_depth === 'standard' || body.metrics_depth === 'power') next.metrics_depth = body.metrics_depth
    if (body.features && typeof body.features === 'object') {
      next = { ...next, features: { ...next.features, ...body.features } }
    }
    if (body.sidebar && typeof body.sidebar === 'object') {
      next = { ...next, sidebar: { ...next.sidebar, ...body.sidebar } }
    }
  }

  const { error } = await supabaseAdmin
    .from('practices').update({ ui_preferences: next }).eq('id', auth.practiceId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await auditEhrAccess({
    user: auth.user, practiceId: auth.practiceId, action: 'note.update',
    resourceId: auth.practiceId,
    details: { kind: 'ui_preferences', applied_preset: body.apply_preset, scale: next.scale, metrics_depth: next.metrics_depth },
  })

  return NextResponse.json({ preferences: next })
}
