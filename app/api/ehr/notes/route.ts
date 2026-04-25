// Harbor EHR — list + create progress notes.
// Cognito-auth + RDS via raw SQL (the ehr_progress_notes Drizzle types are
// stale vs the actual migration; safer to query columns by name here).

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const sp = req.nextUrl.searchParams
  const patientId = sp.get('patient_id')
  const status = sp.get('status')
  const limit = Math.min(Number(sp.get('limit') ?? 100), 200)

  const conds: string[] = ['practice_id = $1']
  const args: unknown[] = [ctx.practiceId]
  if (patientId) { args.push(patientId); conds.push(`patient_id = $${args.length}`) }
  if (status)    { args.push(status);    conds.push(`status = $${args.length}`) }
  args.push(limit)

  const { rows } = await pool.query(
    `SELECT id, practice_id, patient_id, appointment_id, therapist_id,
            title, note_format, status, signed_at, signed_by,
            cpt_codes, icd10_codes, created_at, updated_at
       FROM ehr_progress_notes
      WHERE ${conds.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT $${args.length}`,
    args,
  )

  await auditEhrAccess({
    ctx,
    action: 'note.list',
    details: { patient_id: patientId ?? null, count: rows.length },
  })
  return NextResponse.json({ notes: rows })
}

export async function POST(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  let body: any
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const {
    patient_id, title, note_format, subjective, objective, assessment, plan,
    body: noteBody, appointment_id, therapist_id, cpt_codes, icd10_codes,
  } = body

  if (!patient_id || typeof patient_id !== 'string') {
    return NextResponse.json({ error: 'patient_id is required' }, { status: 400 })
  }
  if (!title || typeof title !== 'string' || !title.trim()) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 })
  }

  // Verify the patient belongs to the caller's practice — protects against
  // creating notes against someone else's patient via ID guessing.
  const patient = await pool.query(
    `SELECT id, practice_id FROM patients WHERE id = $1 LIMIT 1`,
    [patient_id],
  )
  if (!patient.rows[0] || patient.rows[0].practice_id !== ctx.practiceId) {
    return NextResponse.json({ error: 'Patient not found for this practice' }, { status: 404 })
  }

  const insert = await pool.query(
    `INSERT INTO ehr_progress_notes (
       practice_id, patient_id, appointment_id, therapist_id,
       title, note_format, subjective, objective, assessment, plan, body,
       cpt_codes, icd10_codes, status
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::text[], $13::text[], 'draft'
     )
     RETURNING *`,
    [
      ctx.practiceId, patient_id, appointment_id ?? null, therapist_id ?? null,
      title.trim(), note_format || 'soap',
      subjective ?? null, objective ?? null, assessment ?? null, plan ?? null, noteBody ?? null,
      Array.isArray(cpt_codes) ? cpt_codes : [],
      Array.isArray(icd10_codes) ? icd10_codes : [],
    ],
  )
  const note = insert.rows[0]

  await auditEhrAccess({
    ctx,
    action: 'note.create',
    resourceId: note.id,
    details: { patient_id, title: note.title, format: note.note_format },
  })
  return NextResponse.json({ note }, { status: 201 })
}
