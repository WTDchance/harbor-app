import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase'

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // Auth check — must be logged in
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Admin check — only ADMIN_EMAIL can hard-delete patients
    const adminEmail = process.env.ADMIN_EMAIL
    if (!adminEmail || user.email !== adminEmail) {
      return NextResponse.json({ error: 'Forbidden \u2014 admin only' }, { status: 403 })
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
