import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'

// Common mental health insurance payer IDs for Stedi eligibility API
// Full list: https://www.stedi.com/edi/trade-partners
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

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: practice } = await supabase
      .from('practices')
      .select('id, name, npi')
      .eq('notification_email', user.email)
      .single()

    if (!practice) return NextResponse.json({ error: 'Practice not found' }, { status: 404 })

    const body = await req.json()
    const {
      record_id,       // existing insurance_record id (optional)
      patient_name,
      patient_dob,     // YYYY-MM-DD
      insurance_company,
      member_id,
      group_number,
      subscriber_name,
      subscriber_dob,
    } = body

    // Upsert insurance record
    let insuranceRecordId = record_id
    if (!record_id) {
      const { data: newRecord, error: insertError } = await supabase
        .from('insurance_records')
        .insert({
          practice_id: practice.id,
          patient_name,
          patient_dob,
          insurance_company,
          member_id,
          group_number: group_number || null,
          subscriber_name: subscriber_name || patient_name,
          subscriber_dob: subscriber_dob || patient_dob,
        })
        .select('id')
        .single()

      if (insertError || !newRecord) {
        return NextResponse.json({ error: 'Failed to save insurance record' }, { status: 500 })
      }
      insuranceRecordId = newRecord.id
    }

    const stediApiKey = process.env.STEDI_API_KEY
    const payerId = PAYER_IDS[insurance_company] || body.payer_id

    // If no Stedi key configured, return manual verification pending state
    if (!stediApiKey) {
      await supabase.from('eligibility_checks').insert({
        insurance_record_id: insuranceRecordId,
        practice_id: practice.id,
        status: 'manual_pending',
        error_message: 'Automated verification not configured. Add STEDI_API_KEY to enable.',
      })
      return NextResponse.json({
        record_id: insuranceRecordId,
        status: 'manual_pending',
        message: 'Insurance record saved. Add STEDI_API_KEY to Railway for automated verification.',
        setup_url: 'https://www.stedi.com/app/api-keys',
      })
    }

    if (!payerId) {
      return NextResponse.json({
        error: `Payer ID not found for "${insurance_company}". Please provide payer_id manually.`,
        known_payers: Object.keys(PAYER_IDS),
      }, { status: 400 })
    }

    // Call Stedi real-time eligibility API (270/271)
    const controlNumber = Date.now().toString().slice(-9).padStart(9, '0')
    const dobFormatted = (patient_dob || '').replace(/-/g, '') // YYYYMMDD

    const stediPayload = {
      controlNumber,
      tradingPartnerServiceId: payerId,
      provider: {
        organizationName: practice.name || 'Harbor Practice',
        npi: practice.npi || '0000000000',
      },
      subscriber: {
        memberId: member_id,
        firstName: (subscriber_name || patient_name || '').split(' ')[0] || 'PATIENT',
        lastName: (subscriber_name || patient_name || '').split(' ').slice(1).join(' ') || 'UNKNOWN',
        dateOfBirth: dobFormatted,
      },
      encounter: {
        serviceTypeCodes: ['30', 'MH'], // 30 = Mental Health, MH = Mental Health (some payers)
        dateOfService: new Date().toISOString().split('T')[0].replace(/-/g, ''),
      },
    }

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
      await supabase.from('eligibility_checks').insert({
        insurance_record_id: insuranceRecordId,
        practice_id: practice.id,
        status: 'error',
        error_message: errMsg,
        raw_response: stediData,
      })
      return NextResponse.json({ record_id: insuranceRecordId, status: 'error', error: errMsg }, { status: 422 })
    }

    // Parse Stedi response â extract mental health benefits
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

    // Extract key numbers
    const copay = mentalHealthBenefits.find((b: any) => b.benefitAmount && b.code === 'B')?.benefitAmount || null
    const deductibleInfo = mentalHealthBenefits.find((b: any) => b.code === 'C' || b.benefitsServiceLine?.toLowerCase().includes('deductible'))
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
      raw_benefits: mentalHealthBenefits.slice(0, 10),
    }

    // Save result
    await supabase.from('eligibility_checks').insert({
      insurance_record_id: insuranceRecordId,
      practice_id: practice.id,
      status: result.status,
      is_active: result.is_active,
      mental_health_covered: result.mental_health_covered,
      copay_amount: result.copay_amount,
      deductible_total: result.deductible_total,
      deductible_met: result.deductible_met,
      raw_response: stediData,
    })

    return NextResponse.json(result)
  } catch (error) {
    console.error('Insurance verification error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
