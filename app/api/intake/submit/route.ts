import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'

// PHQ-9 scoring
function scorePHQ9(answers: number[]): { score: number; severity: string; recommendation: string } {
  const score = answers.reduce((a, b) => a + b, 0)
  let severity = ''
  let recommendation = ''
  if (score <= 4) { severity = 'Minimal'; recommendation = 'No treatment indicated at this time.' }
  else if (score <= 9) { severity = 'Mild'; recommendation = 'Watchful waiting; repeat PHQ-9 at follow-up.' }
  else if (score <= 14) { severity = 'Moderate'; recommendation = 'Treatment plan; may benefit from counseling.' }
  else if (score <= 19) { severity = 'Moderately Severe'; recommendation = 'Active treatment with medication and/or therapy.' }
  else { severity = 'Severe'; recommendation = 'Immediate initiation of pharmacotherapy and, if severe impairment, refer.' }
  return { score, severity, recommendation }
}

// GAD-7 scoring
function scoreGAD7(answers: number[]): { score: number; severity: string; recommendation: string } {
  const score = answers.reduce((a, b) => a + b, 0)
  let severity = ''
  let recommendation = ''
  if (score <= 4) { severity = 'Minimal'; recommendation = 'No anxiety intervention indicated at this time.' }
  else if (score <= 9) { severity = 'Mild'; recommendation = 'Monitor; may not require treatment.' }
  else if (score <= 14) { severity = 'Moderate'; recommendation = 'Possible anxiety disorder; further evaluation warranted.' }
  else { severity = 'Severe'; recommendation = 'Active treatment strongly recommended.' }
  return { score, severity, recommendation }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { token, phq9_answers, gad7_answers, additional_notes } = body

    if (!token) {
      return NextResponse.json({ error: 'Token is required' }, { status: 400 })
    }

    // Use service client (no auth needed — patient fills this out)
    const supabase = createServiceClient()

    const { data: intake, error: fetchError } = await supabase
      .from('intake_forms')
      .select('*')
      .eq('token', token)
      .eq('status', 'pending')
      .single()

    if (fetchError || !intake) {
      return NextResponse.json({ error: 'Invalid or expired intake form' }, { status: 404 })
    }

    // Check expiry
    if (new Date(intake.expires_at) < new Date()) {
      return NextResponse.json({ error: 'This intake form has expired. Please contact your therapist.' }, { status: 410 })
    }

    const phq9Result = phq9_answers?.length === 9 ? scorePHQ9(phq9_answers) : null
    const gad7Result = gad7_answers?.length === 7 ? scoreGAD7(gad7_answers) : null

    const { error: updateError } = await supabase
      .from('intake_forms')
      .update({
        status: 'completed',
        phq9_answers: phq9_answers || null,
        phq9_score: phq9Result?.score ?? null,
        phq9_severity: phq9Result?.severity ?? null,
        gad7_answers: gad7_answers || null,
        gad7_score: gad7Result?.score ?? null,
        gad7_severity: gad7Result?.severity ?? null,
        additional_notes: additional_notes || null,
        completed_at: new Date().toISOString()
      })
      .eq('id', intake.id)

    if (updateError) {
      console.error('Failed to save intake:', updateError)
      return NextResponse.json({ error: 'Failed to save your responses' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      phq9: phq9Result,
      gad7: gad7Result,
      message: 'Thank you! Your responses have been saved. Your therapist will review them before your appointment.'
    })

  } catch (error) {
    console.error('Intake submit error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const token = searchParams.get('token')
    if (!token) return NextResponse.json({ error: 'Token required' }, { status: 400 })

    const supabase = createServiceClient()
    const { data: intake } = await supabase
      .from('intake_forms')
      .select('status, patient_name, expires_at, questionnaire_type')
      .eq('token', token)
      .single()

    if (!intake) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    return NextResponse.json({
      valid: intake.status === 'pending' && new Date(intake.expires_at) > new Date(),
      status: intake.status,
      patient_name: intake.patient_name,
      questionnaire_type: intake.questionnaire_type,
      expires_at: intake.expires_at
    })
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
