// app/api/ehr/biopsychosocial/route.ts
//
// Wave 38 / TS8 — list/create/update structured biopsychosocial intake.
//
// One row per patient, mutated through draft -> completed -> amended
// states. GET returns the row (or null) for a patient_id; PUT upserts
// the section text and marks status when complete.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SECTIONS = [
  'presenting_problem',
  'history_of_present_illness',
  'psychiatric_history',
  'medical_history',
  'family_history',
  'social_history',
  'substance_use',
  'trauma_history',
  'current_functioning',
  'mental_status_exam',
] as const
type Section = (typeof SECTIONS)[number]

export async function GET(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const patientId = req.nextUrl.searchParams.get('patient_id')
  if (!patientId) return NextResponse.json({ error: 'patient_id required' }, { status: 400 })

  const { rows } = await pool.query(
    `SELECT id, patient_id, therapist_id, appointment_id,
            ${SECTIONS.join(', ')},
            status, completed_at, completed_by, created_at, updated_at
       FROM ehr_biopsychosocial_intakes
      WHERE practice_id = $1 AND patient_id = $2
      LIMIT 1`,
    [ctx.practiceId, patientId],
  )

  await auditEhrAccess({
    ctx,
    action: 'biopsychosocial.view',
    resourceType: 'ehr_biopsychosocial_intake',
    resourceId: rows[0]?.id ?? null,
    details: { patient_id: patientId, found: rows.length > 0 },
  })

  return NextResponse.json({ intake: rows[0] ?? null })
}

export async function PUT(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const body = await req.json().catch(() => null)
  if (!body?.patient_id) return NextResponse.json({ error: 'patient_id required' }, { status: 400 })

  const patientId = String(body.patient_id)
  const apptId = body.appointment_id ? String(body.appointment_id) : null
  const therapistId = body.therapist_id ? String(body.therapist_id) : null
  const wantStatus = body.status === 'completed' ? 'completed' : 'draft'

  // Build the SET clause from whichever sections are present in the body.
  const sets: string[] = []
  const args: unknown[] = []
  for (const sec of SECTIONS) {
    if (sec in body) {
      args.push(body[sec] == null ? null : String(body[sec]))
      sets.push(`${sec} = $${args.length}`)
    }
  }
  if (sets.length === 0 && wantStatus === 'draft') {
    return NextResponse.json({ error: 'no fields to update' }, { status: 400 })
  }
  // status, completed_at, completed_by — set by server
  args.push(wantStatus); sets.push(`status = $${args.length}`)
  if (wantStatus === 'completed') {
    args.push(new Date().toISOString()); sets.push(`completed_at = $${args.length}`)
    args.push(ctx.user.id); sets.push(`completed_by = $${args.length}`)
  }

  // UPSERT — INSERT ... ON CONFLICT (patient_id) DO UPDATE.
  const insertCols = ['practice_id', 'patient_id', 'therapist_id', 'appointment_id', 'status', ...SECTIONS]
  const insertVals: unknown[] = [
    ctx.practiceId, patientId, therapistId, apptId, wantStatus,
    ...SECTIONS.map((s) => (s in body ? (body[s] == null ? null : String(body[s])) : null)),
  ]
  const placeholders = insertVals.map((_, i) => `$${i + 1}`).join(', ')

  // For ON CONFLICT, we re-add status update at the end of the SET list
  // built from the input args. Build a new args array for the update path.
  const updateArgs: unknown[] = []
  const updateSets: string[] = []
  for (const sec of SECTIONS) {
    if (sec in body) {
      updateArgs.push(body[sec] == null ? null : String(body[sec]))
      updateSets.push(`${sec} = $${updateArgs.length}`)
    }
  }
  updateArgs.push(wantStatus); updateSets.push(`status = $${updateArgs.length}`)
  if (wantStatus === 'completed') {
    updateArgs.push(new Date().toISOString()); updateSets.push(`completed_at = $${updateArgs.length}`)
    updateArgs.push(ctx.user.id); updateSets.push(`completed_by = $${updateArgs.length}`)
  }
  // Add appt + therapist if provided
  if (apptId)    { updateArgs.push(apptId);    updateSets.push(`appointment_id = $${updateArgs.length}`) }
  if (therapistId) { updateArgs.push(therapistId); updateSets.push(`therapist_id = $${updateArgs.length}`) }

  // We need both insert and update args concatenated in a single query.
  // Combine with separate parameter spaces for clarity.
  const allArgs = [...insertVals, ...updateArgs]
  const updateClause = updateSets
    .map((s) => {
      // shift each placeholder by insertVals.length
      return s.replace(/\$(\d+)/g, (_, n) => `$${insertVals.length + Number(n)}`)
    })
    .join(', ')

  const sql = `
    INSERT INTO ehr_biopsychosocial_intakes
      (${insertCols.join(', ')})
    VALUES (${placeholders})
    ON CONFLICT (patient_id) DO UPDATE
      SET ${updateClause}
    RETURNING id, patient_id, status, completed_at, updated_at
  `
  const { rows } = await pool.query(sql, allArgs)
  const row = rows[0]

  await auditEhrAccess({
    ctx,
    action: wantStatus === 'completed' ? 'biopsychosocial.complete' : 'biopsychosocial.update',
    resourceType: 'ehr_biopsychosocial_intake',
    resourceId: row.id,
    details: { patient_id: patientId, status: wantStatus, sections_updated: Object.keys(body).filter((k) => SECTIONS.includes(k as Section)) },
  })

  return NextResponse.json({ intake: row })
}
