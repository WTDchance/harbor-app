import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'

// GET /api/insurance/records â list all insurance records for the practice
export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: practice } = await supabase
      .from('practices')
      .select('id')
      .eq('notification_email', user.email)
      .single()

    if (!practice) return NextResponse.json({ error: 'Practice not found' }, { status: 404 })

    const { data: records, error } = await supabase
      .from('insurance_records')
      .select(`
        *,
        eligibility_checks (
          id,
          status,
          is_active,
          mental_health_covered,
          copay_amount,
          deductible_total,
          deductible_met,
          checked_at,
          error_message
        )
      `)
      .eq('practice_id', practice.id)
      .order('created_at', { ascending: false })

    if (error) {
      // Table may not exist yet â return empty gracefully
      if (error.code === '42P01') {
        return NextResponse.json({ records: [], setup_needed: true })
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Attach most recent eligibility check to each record
    const enriched = (records || []).map(r => {
      const checks = r.eligibility_checks || []
      const latest = checks.sort((a: any, b: any) =>
        new Date(b.checked_at).getTime() - new Date(a.checked_at).getTime()
      )[0] || null
      return { ...r, eligibility_checks: undefined, latest_check: latest }
    })

    return NextResponse.json({ records: enriched })
  } catch (error) {
    console.error('Insurance records GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/insurance/records â create a new insurance record
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: practice } = await supabase
      .from('practices')
      .select('id')
      .eq('notification_email', user.email)
      .single()

    if (!practice) return NextResponse.json({ error: 'Practice not found' }, { status: 404 })

    const body = await req.json()
    const { patient_name, patient_dob, patient_phone, insurance_company, member_id, group_number, subscriber_name, subscriber_dob, relationship } = body

    if (!patient_name || !insurance_company || !member_id) {
      return NextResponse.json({ error: 'patient_name, insurance_company, and member_id are required' }, { status: 400 })
    }

    const { data: record, error } = await supabase
      .from('insurance_records')
      .insert({
        practice_id: practice.id,
        patient_name,
        patient_dob: patient_dob || null,
        patient_phone: patient_phone || null,
        insurance_company,
        member_id,
        group_number: group_number || null,
        subscriber_name: subscriber_name || patient_name,
        subscriber_dob: subscriber_dob || patient_dob || null,
        relationship_to_subscriber: relationship || 'self',
      })
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ record })
  } catch (error) {
    console.error('Insurance records POST error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH /api/insurance/records â update an insurance record
export async function PATCH(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const { id, ...updates } = body

    if (!id) return NextResponse.json({ error: 'Record ID required' }, { status: 400 })

    const { data: record, error } = await supabase
      .from('insurance_records')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ record })
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/insurance/records â delete an insurance record
export async function DELETE(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'Record ID required' }, { status: 400 })

    const { error } = await supabase
      .from('insurance_records')
      .delete()
      .eq('id', id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
