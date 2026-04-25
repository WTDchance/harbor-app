import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getEffectivePracticeId } from '@/lib/active-practice'
import { createClient } from '@/lib/supabase-server'
import { requireApiSession } from '@/lib/aws/api-auth'

export const dynamic = 'force-dynamic'

async function resolvePracticeId(): Promise<string | null> {
  const supabase = await createClient()
  const __ctx = await requireApiSession();
  if (__ctx instanceof NextResponse) return __ctx;
  const user = { id: __ctx.user.id, email: __ctx.session.email };
  if (!user) return null
  // Honor the admin act-as cookie so an admin viewing Harbor Demo gets the
  // Harbor Demo feed URL, not their own user.practice_id.
  return await getEffectivePracticeId(supabase, user)
}

export async function GET() {
  const practiceId = await resolvePracticeId()
  if (!practiceId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data, error } = await supabaseAdmin
    .from('practice_crisis_resources')
    .select('*')
    .eq('practice_id', practiceId)
    .order('is_primary', { ascending: false })
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ resources: data ?? [] })
}

export async function POST(req: NextRequest) {
  const practiceId = await resolvePracticeId()
  if (!practiceId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })
  const s = (v: any) => typeof v === 'string' ? (v.trim() || null) : null
  const row = {
    practice_id: practiceId,
    name,
    phone: s(body.phone),
    text_line: s(body.text_line),
    description: s(body.description),
    coverage_area: s(body.coverage_area),
    availability: s(body.availability),
    url: s(body.url),
    is_primary: body.is_primary === true,
    sort_order: typeof body.sort_order === 'number' ? body.sort_order : 0,
    active: body.active !== false,
  }
  const { data, error } = await supabaseAdmin
    .from('practice_crisis_resources').insert(row).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ resource: data })
}
