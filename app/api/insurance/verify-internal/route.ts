import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

// Internal insurance verification endpoint
// Called by the Vapi webhook after a call ends — uses supabaseAdmin (no user auth needed)
// Protected by an internal secret header instead

// Common mental health insurance payer IDs for Stedi eligibility API
const PAYER_IDS: Record<string, string> = {
  'Aetna': '60054',
  'Cigna': '62308',
  'United Healthcare': '87726',
  'UnitedHealthcare': '87726',
  'Humana': '61101',
  'Anthem': '00227',
  'Anthem BCBS': '00227',
  'Blue Cross Blue Shield': '00310',
  'BCBS': '00310',
  'Magellan Health': 'MGLNBH',
  'Optum': '87726',
  'Beacon Health Options': 'BHLTH',
  'Value Options': 'BHLTH',
  'Tricare': 'TRICR',
  'Medicaid': '77003',
  'Medicare': '00120',
  'Oregon Health Plan': 'OREMD',
  'OHP': 'OREMD',
  'Oregon Medicaid': 'OREMD',
  'Cascade Health Alliance': '93688',
  'CHA': '93688',
}

// Fuzzy match insurance company name to payer ID
function resolvePayerId(companyName: string): string | null {
  if (!companyName) return null

  // Direct match first
  if (PAYER_IDS[companyName]) return PAYER_IDS[companyName]

  // Case-insensitive match
  const lower = companyName.toLowerCase()
  for (const [key, value] of Object.entries(PAYER_IDS)) {
    if (key.toLowerCase() === lower) return value
  }

  // Partial match (e.g., "Blue Cross" matches "Blue Cross Blue Shield")
  for (const [key, value] of Object.entries(PAYER_IDS)) {
    if (lower.includes(key.toLowerCase()) || key.toLowerCase().includes(lower)) {
      return value
    }
  }

  return null
}

export async function POST(req: NextRequest) {
  try {
    // Verify internal secret — only the webhook should call this
    const secret = req.headers.get('x-internal-secret') || req.nextUrl.searchParams.get('secret')
    const expectedSecret = process.env.VAPI_WEBHOOK_SECRET

    if (expectedSecret && secret !== expectedSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const {
      practice_id,
      patient_id,
      patient_name,
      patient_dob,       // YYYY-MM-DD
      insurance_company,
      member_id,
      group_number,
      subscriber_name,
      subscriber_dob,
      relationship,       // 'self' or 'dependent'
    } = body

    if (!practice_id || !insurance_company || !member_id) {
      return NextResponse.json({
        error: 'practice_id, insurance_company, and member_id are required',
      }, { status: 400 })
    }

    console.log(`[Insurance] Verifying: ${insurance_company} member ${member_id} for practice ${practice_id}`)

    // 1. Create insurance record
    const { data: record, error: insertError } = await supabaseAdmin
      .from('insurance_records')
      .insert({
        practice_id,
        patient_id: patient_id || null,
        patient_name: patient_name || null,
        patient_dob: patient_dob || null,
        insurance_company,
        member_id,
        group_number: group_number || null,
        subscriber_name: subscriber_name || patient_name || null,
        subscriber_dob: subscriber_dob || patient_dob || null,
        relationship_to_subscriber: relationship || 'self',
      })
      .select('id')
      .single()

    if (insertError || !record) {
      console.error('[Insurance] Failed to create record:', insertError?.message)
      return NextResponse.json({ error: 'Failed to save insurance record' }, { status: 500 })
    }

    const insuranceRecordId = record.id
    console.log(`[Insurance] Record created: ${insuranceRecordId}`)

    // 2. Attempt automated verification via Stedi
    const stediApiKey = process.env.STEDI_API_KEY
    const payerId = resolvePayerId(insurance_company)

    if (!stediApiKey) {
      // No Stedi key — save as manual pending
      await supabaseAdmin.from('eligibility_checks').insert({
        insurance_record_id: insuranceRecordId,
        practice_id,
        status: 'manual_pending',
        error_message: 'Automated verification not configured. Add STEDI_API_KEY to enable.',
      })

      console.log(`[Insurance] No STEDI_API_KEY — saved as manual_pending`)
      return NextResponse.json({
        record_id: insuranceRecordId,
        status: 'manual_pending',
        message: 'Insurance record saved. Automated verification requires STEDI_API_KEY.',
      })
    }

    if (!payerId) {
      // Unknown payer — save record but can't auto-verify
      await supabaseAdmin.from('eligibility_checks').insert({
        insurance_record_id: insuranceRecordId,
        practice_id,
        status: 'manual_pending',
        error_message: `Payer ID not found for "${insurance_company}". Manual verification needed.`,
      })

      console.log(`[Insurance] Unknown payer "${insurance_company}" — saved as manual_pending`)
      return NextResponse.json({
        record_id: insuranceRecordId,
        status: 'manual_pending',
        message: `Payer "${insurance_company}" not in our directory. Manual verification needed.`,
      })
    }

    // Look up practice NPI
    const { data: practice } = await supabaseAdmin
      .from('practices')
      .select('name, npi')
      .eq('id', practice_id)
      .single()

    // 3. Call Stedi real-time eligibility API (270/271)
    const controlNumber = Date.now().toString().slice(-9).padStart(9, '0')
    const dobFormatted = (patient_dob || '').replace(/-/g, '') // YYYYMMDD

    const stediPayload = {
      controlNumber,
      tradingPartnerServiceId: payerId,
      provider: {
        organizationName: practice?.name || 'Harbor Practice',
        npi: practice?.npi || '0000000000',
      },
      subscriber: {
        memberId: member_id,
        firstName: (subscriber_name || patient_name || '').split(' ')[0] || 'PATIENT',
        lastName: (subscriber_name || patient_name || '').split(' ').slice(1).join(' ') || 'UNKNOWN',
        dateOfBirth: dobFormatted,
      },
      encounter: {
        serviceTypeCodes: ['30', 'MH'],
        dateOfService: new Date().toISOString().split('T')[0].replace(/-/g, ''),
      },
    }

    console.log(`[Insurance] Calling Stedi for payer ${payerId} (${insurance_company})`)

    const stediRes = await fetch(
      'https://healthcare.us.stedi.com/2024-04-01/change/medicalnetwork/eligibility/v3',
      {
        method: 'POST',
        headers: {
          'Authorization': `Key ${stediApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(stediPayload),
      }
    )

    const stediData = await stediRes.json()

    if (!stediRes.ok) {
      const errMsg = stediData?.message || stediData?.error || 'Eligibility check failed'
      await supabaseAdmin.from('eligibility_checks').insert({
        insurance_record_id: insuranceRecordId,
        practice_id,
        status: 'error',
        error_message: errMsg,
        raw_response: stediData,
      })

      console.error(`[Insurance] Stedi error: ${errMsg}`)
      return NextResponse.json({
        record_id: insuranceRecordId,
        status: 'error',
        error: errMsg,
      }, { status: 422 })
    }

    // 4. Parse Stedi response — extract mental health benefits
    const benefits = stediData?.benefitsInformation || []
    const activeCoverage = benefits.find((b: any) =>
      b.code === '1' || b.benefitsServiceLine === 'Plan'
    )
    const mentalHealthBenefits = benefits.filter((b: any) =>
      b.serviceTypeCodes?.includes('MH') ||
      b.serviceTypeCodes?.includes('30') ||
      b.serviceTypeCodes?.includes('A4') ||
      (b.serviceTypeDescription || '').toLowerCase().includes('mental')
    )

    const copay = mentalHealthBenefits.find((b: any) =>
      b.benefitAmount && b.code === 'B'
    )?.benefitAmount || null

    const deductibleInfo = mentalHealthBenefits.find((b: any) =>
      b.code === 'C' || b.benefitsServiceLine?.toLowerCase().includes('deductible')
    )
    const deductibleTotal = deductibleInfo?.benefitAmount || null
    const deductibleMet = mentalHealthBenefits.find((b: any) =>
      (b.code === 'C' || b.benefitsServiceLine?.toLowerCase().includes('deductible')) &&
      (b.benefitsServiceLine || '').toLowerCase().includes('spend')
    )?.benefitAmount || null

    const isActive = stediData?.planStatus?.[0]?.statusCode === '1' ||
      (activeCoverage && activeCoverage.code === '1')

    const result = {
      record_id: insuranceRecordId,
      status: isActive ? 'active' : 'inactive',
      insurance_company,
      member_id,
      is_active: isActive,
      mental_health_covered: mentalHealthBenefits.length > 0,
      copay_amount: copay ? parseFloat(copay) : null,
      deductible_total: deductibleTotal ? parseFloat(deductibleTotal) : null,
      deductible_met: deductibleMet ? parseFloat(deductibleMet) : null,
      plan_name: stediData?.planStatus?.[0]?.statusDescription || null,
      group_name: stediData?.planInformation?.groupDescription || null,
    }

    // 5. Save eligibility check result
    await supabaseAdmin.from('eligibility_checks').insert({
      insurance_record_id: insuranceRecordId,
      practice_id,
      status: result.status,
      is_active: result.is_active,
      mental_health_covered: result.mental_health_covered,
      copay_amount: result.copay_amount,
      deductible_total: result.deductible_total,
      deductible_met: result.deductible_met,
      raw_response: stediData,
    })

    console.log(`[Insurance] Verification complete: ${result.status}, MH covered: ${result.mental_health_covered}, copay: $${result.copay_amount || 'N/A'}`)

    return NextResponse.json(result)
  } catch (error) {
    console.error('[Insurance] Internal verification error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
