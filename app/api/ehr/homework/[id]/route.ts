// app/api/ehr/homework/[id]/route.ts — update/cancel.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireEhrAuth, isAuthError } from '@/lib/ehr/auth'

const UPDATABLE = new Set(['title','description','due_date','status'])

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireEhrAuth(); if (isAuthError(auth)) return auth
  const { id } = await params
  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  const patch: any = {}
  for (const [k, v] of Object.entries(body)) if (UPDATABLE.has(k)) patch[k] = v
  if (patch.status === 'completed') patch.completed_at = new Date().toISOString()
  if (!Object.keys(patch).length) return NextResponse.json({ error: 'No updatable fields' }, { status: 400 })
  const { data, error } = await supabaseAdmin
    .from('ehr_homework').update(patch).eq('id', id).eq('practice_id', auth.practiceId).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ homework: data })
}
