// FILE: app/api/admin/repair-practice/route.ts
// Admin-only: read or patch ANY field on a practice, including normally-
// protected infrastructure columns (phone_number, twilio_phone_sid,
// vapi_assistant_id, vapi_phone_number_id, etc.).
//
// This is the "break glass" endpoint — used when a practice row was
// mis-created and needs surgical correction before re-provisioning Vapi.
//
// Auth: Bearer ${CRON_SECRET}
//
// GET  ?practice_id=<uuid>        → returns the full row
// POST { practice_id, ...fields } → patches supplied fields, returns before + after

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

function checkAuth(req: NextRequest): boolean {
  const auth = req.headers.get('authorization') || ''
  const expected = `Bearer ${process.env.CRON_SECRET || ''}`
  return !!process.env.CRON_SECRET && auth === expected
}

export async function GET(req: NextRequest) {
  if (!checkAuth(req)) return unauthorized()

  const practiceId = req.nextUrl.searchParams.get('practice_id')
  if (!practiceId) {
    return NextResponse.json({ error: 'practice_id required' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('practices')
    .select('*')
    .eq('id', practiceId)
    .single()

  if (error || !data) {
    return NextResponse.json({ error: error?.message || 'not found' }, { status: 404 })
  }

  return NextResponse.json({ practice: data })
}

export async function POST(req: NextRequest) {
  if (!checkAuth(req)) return unauthorized()

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const practiceId = body.practice_id as string | undefined
  if (!practiceId) {
    return NextResponse.json({ error: 'practice_id required' }, { status: 400 })
  }

  // Snapshot before
  const { data: before, error: readErr } = await supabaseAdmin
    .from('practices')
    .select('*')
    .eq('id', practiceId)
    .single()

  if (readErr || !before) {
    return NextResponse.json({ error: readErr?.message || 'not found' }, { status: 404 })
  }

  // Build patch from everything except practice_id
  const patch: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(body)) {
    if (key === 'practice_id') continue
    patch[key] = value
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'no fields supplied', before }, { status: 400 })
  }

  const { data: after, error: upErr } = await supabaseAdmin
    .from('practices')
    .update(patch)
    .eq('id', practiceId)
    .select('*')
    .single()

  if (upErr) {
    return NextResponse.json({ error: upErr.message, before }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    patched_keys: Object.keys(patch),
    before,
    after,
  })
}
