import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

function calculateScore(responses: number[], type: 'phq9' | 'gad7') {
    const total = responses.reduce((sum, r) => sum + r, 0)
    let severity = ''
    if (type === 'phq9') {
          if (total <= 4) severity = 'minimal'
          else if (total <= 9) severity = 'mild'
          else if (total <= 14) severity = 'moderate'
          else if (total <= 19) severity = 'moderately_severe'
          else severity = 'severe'
        } else {
          if (total <= 4) severity = 'minimal'
          else if (total <= 9) severity = 'mild'
          else if (total <= 14) severity = 'moderate'
          else severity = 'severe'
        }
    return { score: total, severity }
  }

export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
    try {
          const { data } = await supabaseAdmin
            .from('outcome_assessments')
            .select('status, assessment_type, practice_id, patient_name, practices(name)')
            .eq('token', params.token)
            .single()

          if (!data) return NextResponse.json({ error: 'Assessment not found or expired' }, { status: 404 })
          if (data.status === 'completed') return NextResponse.json({ error: 'This assessment has already been completed' }, { status: 400 })

          return NextResponse.json({
                  assessment_type: data.assessment_type,
                  patient_name: data.patient_name,
                  practice_name: (data.practices as any)?.name || 'Your Practice',
                })
        } catch {
          return NextResponse.json({ error: 'Not found' }, { status: 404 })
        }
  }

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
    try {
          const { responses } = await req.json()

          const { data: assessment } = await supabaseAdmin
            .from('outcome_assessments')
            .select('id, status, assessment_type')
            .eq('token', params.token)
            .single()

          if (!assessment) return NextResponse.json({ error: 'Not found' }, { status: 404 })
          if (assessment.status === 'completed') return NextResponse.json({ error: 'Already completed' }, { status: 400 })

          const { score, severity } = calculateScore(responses, assessment.assessment_type as 'phq9' | 'gad7')

          await supabaseAdmin
            .from('outcome_assessments')
            .update({
                      responses,
                      score,
                      severity,
                      status: 'completed',
                      completed_at: new Date().toISOString(),
                    })
            .eq('token', params.token)

          return NextResponse.json({ success: true, score, severity })
        } catch (error: any) {
          return NextResponse.json({ error: error.message }, { status: 500 })
        }
  }
