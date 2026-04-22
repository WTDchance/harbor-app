// app/api/portal/assessments/route.ts — patient sees their pending + recent assessments.
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getPortalSession } from '@/lib/ehr/portal'

export async function GET() {
  const session = await getPortalSession()
  if (!session) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const { data, error } = await supabaseAdmin
    .from('patient_assessments')
    .select('id, assessment_type, status, score, severity, assigned_at, expires_at, completed_at, created_at')
    .eq('practice_id', session.practice_id)
    .eq('patient_id', session.patient_id)
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ assessments: data })
}
