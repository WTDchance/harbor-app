import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireApiSession } from '@/lib/aws/api-auth'

// GET /api/admin/patients/:id — fetch a single patient (or use id=search with query params)
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authHeader = request.headers.get('authorization') || ''
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const patientId = params.id

  // Special case: id=search — look up by practice_id + phone
  if (patientId === 'search') {
    const practiceId = request.nextUrl.searchParams.get('practice_id')
    const phone = request.nextUrl.searchParams.get('phone')
    if (!practiceId) {
      return NextResponse.json({ error: 'practice_id required' }, { status: 400 })
    }

    let query = supabaseAdmin
      .from('patients')
      .select('*')
      .eq('practice_id', practiceId)
      .order('created_at', { ascending: false })
      .limit(20)

    if (phone) {
      const normalized = phone.replace(/\D/g, '').slice(-10)
      query = query.ilike('phone', `%${normalized}`)
    }

    const { data, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ patients: data })
  }

  // Normal case: fetch by ID
  const { data, error } = await supabaseAdmin
    .from('patients')
    .select('*')
    .eq('id', patientId)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(data)
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // Auth: accept either CRON_SECRET bearer token or logged-in admin session
    const authHeader = request.headers.get('authorization') || ''
    const cronSecret = process.env.CRON_SECRET
    const isCronAuth = cronSecret && authHeader === `Bearer ${cronSecret}`

    if (!isCronAuth) {
      const supabase = await createClient()
      const __ctx = await requireApiSession();
  if (__ctx instanceof NextResponse) return __ctx;
  const user = { id: __ctx.user.id, email: __ctx.session.email };
  if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      const adminEmail = process.env.ADMIN_EMAIL
      if (!adminEmail || user.email !== adminEmail) {
        return NextResponse.json({ error: 'Forbidden \u2014 admin only' }, { status: 403 })
      }
    }

    const patientId = params.id
    if (!patientId) {
      return NextResponse.json({ error: 'Patient ID required' }, { status: 400 })
    }

    // Verify the patient exists
    const { data: patient, error: fetchError } = await supabaseAdmin
      .from('patients')
      .select('id, first_name, last_name, practice_id')
      .eq('id', patientId)
      .single()

    if (fetchError || !patient) {
      return NextResponse.json({ error: 'Patient not found' }, { status: 404 })
    }

    // Delete related records in dependency order (child tables first)
    const deletions = [
      { table: 'intake_submissions', label: 'intake submissions' },
      { table: 'intake_forms', label: 'intake forms' },
      { table: 'intake_tokens', label: 'intake tokens' },
      { table: 'appointments', label: 'appointments' },
      { table: 'call_logs', label: 'call logs' },
    ]

    const results: { table: string; deleted: number; error?: string }[] = []

    for (const { table, label } of deletions) {
      const { data, error } = await supabaseAdmin
        .from(table)
        .delete()
        .eq('patient_id', patientId)
        .select('id')

      if (error) {
        console.error(`Error deleting from ${table}:`, error)
        results.push({ table, deleted: 0, error: error.message })
      } else {
        results.push({ table, deleted: data?.length || 0 })
        if (data?.length) {
          console.log(`Deleted ${data.length} ${label} for patient ${patientId}`)
        }
      }
    }

    // Also clean up sms_conversations by phone (if patient has phone)
    if (patient.practice_id) {
      const { data: smsData, error: smsError } = await supabaseAdmin
        .from('patients')
        .select('phone')
        .eq('id', patientId)
        .single()

      if (smsData?.phone) {
        const { data: smsDeleted, error: smsDelErr } = await supabaseAdmin
          .from('sms_conversations')
          .delete()
          .eq('patient_phone', smsData.phone)
          .eq('practice_id', patient.practice_id)
          .select('id')

        if (smsDelErr) {
          results.push({ table: 'sms_conversations', deleted: 0, error: smsDelErr.message })
        } else {
          results.push({ table: 'sms_conversations', deleted: smsDeleted?.length || 0 })
        }
      }
    }

    // Finally delete the patient record itself
    const { error: deleteError } = await supabaseAdmin
      .from('patients')
      .delete()
      .eq('id', patientId)

    if (deleteError) {
      console.error('Error deleting patient:', deleteError)
      return NextResponse.json({
        error: 'Failed to delete patient record',
        details: deleteError.message,
        partial_results: results,
      }, { status: 500 })
    }

    const patientName = [patient.first_name, patient.last_name].filter(Boolean).join(' ') || 'Unknown'
    console.log(`ADMIN: Hard-deleted patient ${patientName} (${patientId}) and all related records`)

    return NextResponse.json({
      success: true,
      message: `Permanently deleted patient ${patientName} and all related records`,
      patient_id: patientId,
      patient_name: patientName,
      deletions: results,
    })
  } catch (error) {
    console.error('Hard delete error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
