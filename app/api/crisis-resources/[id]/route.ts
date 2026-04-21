import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { createClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

async function resolvePracticeId(): Promise<string | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabaseAdmin
    .from('users').select('practice_id').eq('id', user.id).maybeSingle()
  return data?.practice_id ?? null
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const practiceId = await resolvePracticeId()
  if (!practiceId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const updates: Record<string, any> = { updated_at: new Date().toISOString() }
  const allowed = ['name','phone','text_line','description','coverage_area','availability','url','is_primary','sort_order','active']
  for (const f of allowed) {
    if (f in body) {
      const v = body[f]
      if (typeof v === 'string') updates[f] = v.trim() || null
      else if (typeof v === 'boolean' || typeof v === 'number' || v === null) updates[f] = v
    }
  }
  const { data, error } = await supabaseAdmin
    .from('practice_crisis_resources')
    .update(updates).eq('id', params.id).eq('practice_id', practiceId)
    .select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ resource: data })
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const practiceId = await resolvePracticeId()
  if (!practiceId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { error } = await supabaseAdmin
    .from('practice_crisis_resources')
    .delete().eq('id', params.id).eq('practice_id', practiceId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
