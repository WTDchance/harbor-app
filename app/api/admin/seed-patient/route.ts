// Admin-only: seed or remove a patient row under any practice so Ellie /
// intake / reminder flows have someone to recognize. Used to prep the
// Harbor Demo practice with Chance as a "known patient" so demo calls don't
// return "patient not found" and so the 24-hour reminder + intake email
// paths can be exercised end-to-end.
//
// Auth: Bearer ${CRON_SECRET}
//
// POST   { practice_id, first_name, phone, ...optional } — create/upsert
// DELETE { practice_id, patient_id? | phone? }          — remove a stale row
//
// Behavior:
//   - POST validates practice exists, upserts by (practice_id, phone), and
//     refreshes name/email/DOB/notes so re-running is safe.
//   - DELETE removes exactly one patient row scoped to practice_id,
//     matched by patient_id (preferred) or phone.

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

interface SeedBody {
  practice_id?: string
  first_name?: string
  last_name?: string
  phone?: string
  email?: string
  date_of_birth?: string
  preferred_session_type?: string
  notes?: string
}

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') || ''
  const expected = `Bearer ${process.env.CRON_SECRET || ''}`
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: SeedBody
  try {
    body = (await req.json()) as SeedBody
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const {
    practice_id,
    first_name,
    last_name,
    phone,
    email,
    date_of_birth,
    preferred_session_type,
    notes,
  } = body

  if (!practice_id || !first_name || !phone) {
    return NextResponse.json(
      { error: 'practice_id, first_name, phone are required' },
      { status: 400 }
    )
  }

  // Verify practice exists so we don't orphan rows.
  const { data: practice, error: practiceErr } = await supabaseAdmin
    .from('practices')
    .select('id, name')
    .eq('id', practice_id)
    .maybeSingle()

  if (practiceErr) {
    return NextResponse.json(
      { error: `practice lookup failed: ${practiceErr.message}` },
      { status: 500 }
    )
  }
  if (!practice) {
    return NextResponse.json({ error: 'practice not found' }, { status: 404 })
  }

  // Existing patient for (practice_id, phone)? Update in place.
  const { data: existing } = await supabaseAdmin
    .from('patients')
    .select('id')
    .eq('practice_id', practice_id)
    .eq('phone', phone)
    .maybeSingle()

  const payload: Record<string, unknown> = {
    practice_id,
    first_name,
    last_name: last_name ?? null,
    phone,
    email: email ?? null,
    date_of_birth: date_of_birth ?? null,
    preferred_session_type: preferred_session_type ?? null,
    notes: notes ?? null,
  }

  if (existing?.id) {
    const { data, error } = await supabaseAdmin
      .from('patients')
      .update(payload)
      .eq('id', existing.id)
      .select()
      .single()
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true, created: false, patient: data })
  }

  const { data, error } = await supabaseAdmin
    .from('patients')
    .insert(payload)
    .select()
    .single()
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true, created: true, patient: data })
}

export async function DELETE(req: NextRequest) {
  const auth = req.headers.get('authorization') || ''
  const expected = `Bearer ${process.env.CRON_SECRET || ''}`
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: { practice_id?: string; patient_id?: string; phone?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const { practice_id, patient_id, phone } = body
  if (!practice_id) {
    return NextResponse.json({ error: 'practice_id is required' }, { status: 400 })
  }
  if (!patient_id && !phone) {
    return NextResponse.json(
      { error: 'patient_id or phone is required to identify the row' },
      { status: 400 }
    )
  }

  let query = supabaseAdmin.from('patients').delete().eq('practice_id', practice_id)
  if (patient_id) query = query.eq('id', patient_id)
  else if (phone) query = query.eq('phone', phone)

  const { data, error } = await query.select()
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, deleted: data?.length || 0, rows: data || [] })
}
