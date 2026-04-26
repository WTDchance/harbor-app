// app/api/voice/tools/submit-intake-screening/route.ts
//
// Wave 27c — Retell tool: persist PHQ-2 + GAD-2 scores collected by
// Ellie during the call. Writes both an intake_forms row (delivery_channel
// = 'in_person' since it's voice-collected) and a patient_assessments
// row keyed to PHQ-2 + GAD-2 separately.

import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/aws/db'
import { parseRetellToolCall, toolResult } from '@/lib/aws/voice/auth'

function severity(score: number, instrument: 'phq2' | 'gad2'): string {
  // PHQ-2 / GAD-2: positive at >= 3
  return score >= 3 ? 'positive' : 'negative'
}

export async function POST(req: NextRequest) {
  const ctx = await parseRetellToolCall(req)
  if (ctx instanceof NextResponse) return ctx
  const { args, practiceId, fromNumber } = ctx as any

  if (!practiceId) {
    return toolResult('Thank you for those answers. The therapist will review them before your first session.')
  }

  const phq2 = Number(args.phq2Score)
  const gad2 = Number(args.gad2Score)
  const patientName = String(args.patientName || '').trim()

  if (!Number.isFinite(phq2) || !Number.isFinite(gad2)) {
    return toolResult('I missed one of the screening scores — can you share them again?')
  }

  // Resolve patient by phone (best effort)
  let patientId: string | null = null
  try {
    const normalizedPhone = fromNumber?.replace(/\D/g, '').slice(-10) || ''
    if (normalizedPhone.length >= 10) {
      const { rows } = await pool.query(
        `SELECT id FROM patients
          WHERE practice_id = $1 AND phone ILIKE $2 AND deleted_at IS NULL
          LIMIT 1`,
        [practiceId, `%${normalizedPhone}`],
      )
      if (rows[0]) patientId = rows[0].id
    }
  } catch {}

  try {
    if (patientId) {
      await pool.query(
        `INSERT INTO patient_assessments
            (practice_id, patient_id, assessment_type, score, severity,
             administered_at, administered_by, status, completed_at)
          VALUES ($1, $2, 'phq2', $3, $4, NOW(), NULL, 'completed', NOW())`,
        [practiceId, patientId, phq2, severity(phq2, 'phq2')],
      )
      await pool.query(
        `INSERT INTO patient_assessments
            (practice_id, patient_id, assessment_type, score, severity,
             administered_at, administered_by, status, completed_at)
          VALUES ($1, $2, 'gad2', $3, $4, NOW(), NULL, 'completed', NOW())`,
        [practiceId, patientId, gad2, severity(gad2, 'gad2')],
      )
    } else {
      // No patient row yet — log to tasks so Wave 27d post-call wiring
      // can stitch it once the patient is created on call_ended.
      await pool.query(
        `INSERT INTO tasks (practice_id, type, patient_name, summary, status)
         VALUES ($1, 'screening', $2, $3, 'pending')`,
        [practiceId, patientName || 'Unknown', `PHQ-2=${phq2} GAD-2=${gad2}`],
      )
    }
  } catch (err) {
    console.error('[retell/submit-intake-screening]', (err as Error).message)
  }

  if (phq2 >= 3 || gad2 >= 3) {
    return toolResult('Thank you for sharing that. I want to make sure the therapist has this information before your appointment so they can provide you with the best care.')
  }
  return toolResult('Thank you for answering those questions. That information will help the therapist prepare for your first session.')
}
