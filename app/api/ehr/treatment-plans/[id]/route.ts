// app/api/ehr/treatment-plans/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireEhrAuth, isAuthError } from '@/lib/ehr/auth'
import { auditEhrAccess } from '@/lib/ehr/audit'

const UPDATABLE = new Set([
  'title','presenting_problem','diagnoses','goals','frequency','start_date','review_date','status','therapist_id',
])

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireEhrAuth(); if (isAuthError(auth)) return auth
  const { id } = await params
  const { data } = await supabaseAdmin
    .from('ehr_treatment_plans').select('*').eq('id', id).eq('practice_id', auth.practiceId).maybeSingle()
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ plan: data })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireEhrAuth(); if (isAuthError(auth)) return auth
  const { id } = await params
  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const patch: Record<string, any> = {}
  for (const [k, v] of Object.entries(body)) if (UPDATABLE.has(k)) patch[k] = v
  if (!Object.keys(patch).length) return NextResponse.json({ error: 'No updatable fields' }, { status: 400 })

  // If promoting to active, demote prior active.
  if (patch.status === 'active') {
    const { data: row } = await supabaseAdmin
      .from('ehr_treatment_plans').select('patient_id').eq('id', id).eq('practice_id', auth.practiceId).maybeSingle()
    if (row?.patient_id) {
      await supabaseAdmin
        .from('ehr_treatment_plans')
        .update({ status: 'revised' })
        .eq('practice_id', auth.practiceId).eq('patient_id', row.patient_id)
        .eq('status', 'active').neq('id', id)
    }
  }

  const { data, error } = await supabaseAdmin
    .from('ehr_treatment_plans').update(patch).eq('id', id).eq('practice_id', auth.practiceId).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  await auditEhrAccess({
    user: auth.user, practiceId: auth.practiceId,
    action: 'note.update', resourceId: id, details: { kind: 'treatment_plan', fields: Object.keys(patch) },
  })
  return NextResponse.json({ plan: data })
}
