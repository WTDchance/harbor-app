// Therapist-side intake submission detail.
// requireApiSession (Cognito). Read-only — no PATCH/DELETE on AWS in this
// batch (the legacy file was GET-only too despite the brief mentioning
// PATCH/DELETE; nothing to defer).
//
// Lifts the eligibility-checks-style nested join into two queries assembled
// in Node, since pool doesn't have a PostgREST nested-select equivalent.

import { NextResponse, type NextRequest } from 'next/server'
import { requireApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireApiSession()
  if (ctx instanceof NextResponse) return ctx
  if (!ctx.practiceId) return NextResponse.json({ error: 'Practice not found' }, { status: 404 })

  const { id } = await params

  const r = await pool.query(
    `SELECT id, status, token,
            patient_name, patient_phone, patient_email,
            patient_dob, patient_address,
            demographics, insurance, signature_data, signed_name,
            phq9_answers, phq9_score, phq9_severity,
            gad7_answers, gad7_score, gad7_severity,
            additional_notes, completed_at, created_at
       FROM intake_forms
      WHERE id = $1 AND practice_id = $2 LIMIT 1`,
    [id, ctx.practiceId],
  )
  const submission = r.rows[0]
  if (!submission) return NextResponse.json({ error: 'Submission not found' }, { status: 404 })

  // Joined intake_document_signatures + intake_documents (best-effort).
  let docSignatures: any[] = []
  try {
    const sigRows = await pool.query(
      `SELECT s.id, s.signed_name, s.signed_at, s.signature_image,
              s.additional_fields,
              d.id AS doc_id, d.name AS doc_name, d.requires_signature
         FROM intake_document_signatures s
         LEFT JOIN intake_documents d ON d.id = s.intake_document_id
        WHERE s.intake_form_id = $1
        ORDER BY s.signed_at ASC`,
      [id],
    )
    docSignatures = sigRows.rows.map(r => ({
      id: r.id,
      signed_name: r.signed_name,
      signed_at: r.signed_at,
      signature_image: r.signature_image,
      additional_fields: r.additional_fields,
      intake_documents: r.doc_id
        ? { id: r.doc_id, name: r.doc_name, requires_signature: r.requires_signature }
        : null,
    }))
  } catch { /* tables may not exist — empty list */ }

  return NextResponse.json({
    submission: { ...submission, intake_document_signatures: docSignatures },
  })
}
