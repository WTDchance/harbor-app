import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { resolvePracticeIdForApi } from '@/lib/active-practice'
import { requireApiSession } from '@/lib/aws/api-auth'

async function getPractice() {
  // supabase client removed (Cognito auth)
  const __ctx = await requireApiSession();
  if (__ctx instanceof NextResponse) return __ctx;
  const user = { id: __ctx.user.id, email: __ctx.session.email };
  if (!user) return null
  const practiceId = await resolvePracticeIdForApi(supabaseAdmin, user)
  if (!practiceId) return null
  const { data } = await supabaseAdmin.from('practices').select('id, name').eq('id', practiceId).single()
  return data
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const practice = await getPractice()
    if (!practice) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Verify crisis alert belongs to user's practice
    const { data: crisisAlert } = await supabaseAdmin
      .from('crisis_alerts')
      .select('practice_id')
      .eq('id', params.id)
      .single()

    if (!crisisAlert || crisisAlert.practice_id !== practice.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { error } = await supabaseAdmin
      .from('crisis_alerts')
      .update({ reviewed: true, reviewed_at: new Date().toISOString() })
      .eq('id', params.id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error marking crisis alert as reviewed:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
