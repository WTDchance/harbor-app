// Admin-only: patch editable fields on a practice row.
// Used to clean up stale contact info without having to crack open Supabase.
//
// Auth: Bearer ${CRON_SECRET}
// POST {
//   practice_id: string,
//   // any subset of:
//   name?: string
//   therapist_name?: string
//   therapist_phone?: string
//   owner_phone?: string
//   notification_email?: string
//   ai_name?: string
//   telehealth?: boolean
//   specialties?: string[]
// }
//
// Only whitelisted keys are forwarded — callers cannot overwrite vapi_*,
// stripe_*, twilio_*, status, or subscription_* via this endpoint.

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

const ALLOWED_KEYS = [
  'name',
  'therapist_name',
  'therapist_phone',
  'owner_phone',
  'notification_email',
  'ai_name',
  'telehealth',
  'specialties',
] as const

type AllowedKey = typeof ALLOWED_KEYS[number]

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') || ''
  const expected = `Bearer ${process.env.CRON_SECRET || ''}`
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const practice_id = body.practice_id
  if (typeof practice_id !== 'string' || !practice_id) {
    return NextResponse.json({ error: 'practice_id is required' }, { status: 400 })
  }

  const patch: Record<string, unknown> = {}
  for (const key of ALLOWED_KEYS) {
    if (key in body) {
      patch[key as AllowedKey] = body[key]
    }
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { error: 'no allowed fields supplied', allowed: ALLOWED_KEYS },
      { status: 400 }
    )
  }

  const { data, error } = await supabaseAdmin
    .from('practices')
    .update(patch)
    .eq('id', practice_id)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, patched: Object.keys(patch), practice: data })
}
