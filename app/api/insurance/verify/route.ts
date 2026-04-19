import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { runAndPersistEligibilityCheck } from '@/lib/stedi/eligibility'
import { knownPayerNames, resolvePayerId } from '@/lib/stedi/payers'
import { getEffectivePracticeId } from '@/lib/active-practice'

// Real-time eligibility check. Called from the insurance dashboard
// ("Verify" button) and any caller passing a user session cookie.
// Batch and intake triggers use the same underlying lib but with the
// service-role client — see lib/stedi/eligibility.ts.
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Resolves via the users table (or admin act-as cookie) so this works
    // regardless of whether the logged-in email matches notification_email.
    const practiceId = await getEffectivePracticeId(supabase, user)
    if (!practiceId) {
      return NextResponse.json({ error: 'Practice not found for this user' }, { status: 404 })
    }
    const { data: practice } = await supabase
      .from('practices')
      .select('id, name, npi')
      .eq('id', practiceId)
      .single()
    if (!practice) return NextResponse.json({ error: 'Practice not found' }, { status: 404 })

    const body = await req.json()
    const {
      record_id,            // existing insurance_records.id (optional)
      patient_id,           // optional — lets us link the row to a patient
      patient_name,
      patient_dob,          // YYYY-MM-DD
      patient_phone,
      insurance_company,
      member_id,
      group_number,
      subscriber_name,
      subscriber_dob,
      payer_id: payerIdOverride,
    } = body

    if (!insurance_company || !patient_name) {
      return NextResponse.json(
        { error: 'insurance_company and patient_name are required' },
        { status: 400 }
      )
    }

    // Fail fast on unknown payers so the dashboard can surface a helpful error
    // instead of writing a "manual_pending" row for something the user typo'd.
    if (!payerIdOverride && !resolvePayerId(insurance_company)) {
      return NextResponse.json({
        error: `Payer ID not found for "${insurance_company}". Provide payer_id manually.`,
        known_payers: knownPayerNames(),
      }, { status: 400 })
    }

    // Upsert insurance_records. If the caller passed an existing record_id we
    // reuse it (so the dashboard's "Verify again" button doesn't fragment history).
    let insuranceRecordId = record_id as string | undefined
    if (!insuranceRecordId) {
      const { data: newRecord, error: insertError } = await supabase
        .from('insurance_records')
        .insert({
          practice_id: practice.id,
          patient_id: patient_id || null,
          patient_name,
          patient_dob: patient_dob || null,
          patient_phone: patient_phone || null,
          insurance_company,
          member_id: member_id || null,
          group_number: group_number || null,
          subscriber_name: subscriber_name || patient_name,
          subscriber_dob: subscriber_dob || patient_dob || null,
        })
        .select('id')
        .single()

      if (insertError || !newRecord) {
        console.error('[verify] failed to insert insurance_records', insertError)
        return NextResponse.json({ error: 'Failed to save insurance record' }, { status: 500 })
      }
      insuranceRecordId = newRecord.id
    }

    const result = await runAndPersistEligibilityCheck(supabase, {
      insuranceRecordId: insuranceRecordId!,
      practice: {
        id: practice.id,
        name: practice.name ?? null,
        npi: practice.npi ?? null,
      },
      patient: {
        name: patient_name,
        dob: patient_dob || null,
        phone: patient_phone || null,
      },
      insurance: {
        company: insurance_company,
        memberId: member_id || null,
        groupNumber: group_number || null,
        payerIdOverride: payerIdOverride || null,
      },
      subscriber: {
        name: subscriber_name || null,
        dob: subscriber_dob || null,
      },
      triggerSource: 'manual',
    })

    // Map back to the legacy response shape the dashboard UI consumes today.
    const httpStatus = result.status === 'error' ? 422 : 200
    return NextResponse.json({
      record_id: result.insuranceRecordId,
      status: result.status,
      insurance_company,
      member_id,
      is_active: result.isActive,
      mental_health_covered: result.mentalHealthCovered,
      copay_amount: result.copayAmount,
      coinsurance_percent: result.coinsurancePercent,
      deductible_total: result.deductibleTotal,
      deductible_met: result.deductibleMet,
      session_limit: result.sessionLimit,
      prior_auth_required: result.priorAuthRequired,
      plan_name: result.planName,
      coverage_end_date: result.coverageEndDate,
      error: result.errorMessage,
    }, { status: httpStatus })
  } catch (error) {
    console.error('[verify] unexpected error', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
