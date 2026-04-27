// app/api/ehr/patients/[id]/discharge-summary/route.ts
//
// Wave 39 / Task 2 — Discharge summary fetch + create + update.
//
// One row per patient (UNIQUE constraint on patient_id):
//   GET   → fetch (or null if none yet)
//   POST  → create draft
//   PATCH → update fields (draft only; once completed, returns 409
//           — amendments are a future endpoint not yet scoped)
//
// Completion lives at /complete/route.ts because it has a side
// effect (flip patients.patient_status = 'discharged') that we
// want a separate audit row for.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const VALID_REASONS = new Set([
  'completed', 'mutual_termination', 'therapist_initiated',
  'patient_initiated', 'transferred', 'no_show_extended', 'other',
])

const TEXT_FIELDS = [
  'services_dates', 'presenting_problem', 'course_of_treatment',
  'progress_summary', 'recommendations',
  'medications_at_discharge', 'risk_assessment_at_discharge', 'referrals',
] as const

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id: patientId } = await params

  const { rows } = await pool.query(
    `SELECT * FROM ehr_discharge_summaries
      WHERE practice_id = $1 AND patient_id = $2
      LIMIT 1`,
    [ctx.practiceId, patientId],
  )

  await auditEhrAccess({
    ctx,
    action: 'discharge_summary.viewed',
    resourceType: 'ehr_discharge_summary',
    resourceId: rows[0]?.id ?? null,
    details: { patient_id: patientId, found: rows.length > 0 },
  })

  return NextResponse.json({ summary: rows[0] ?? null })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id: patientId } = await params

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>

  // Optional initial values; everything is editable later via PATCH.
  const reason = typeof body.discharge_reason === 'string' && VALID_REASONS.has(body.discharge_reason)
    ? body.discharge_reason : 'completed'

  try {
    const { rows } = await pool.query(
      `INSERT INTO ehr_discharge_summaries
         (practice_id, patient_id, discharged_by, discharge_reason)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [ctx.practiceId, patientId, ctx.user.id, reason],
    )
    await auditEhrAccess({
      ctx,
      action: 'discharge_summary.created',
      resourceType: 'ehr_discharge_summary',
      resourceId: rows[0].id,
      details: { patient_id: patientId, discharge_reason: reason },
    })
    return NextResponse.json({ summary: rows[0] }, { status: 201 })
  } catch (err) {
    // UNIQUE(patient_id) violation — return the existing row.
    if ((err as any)?.code === '23505') {
      const { rows } = await pool.query(
        `SELECT * FROM ehr_discharge_summaries
          WHERE practice_id = $1 AND patient_id = $2 LIMIT 1`,
        [ctx.practiceId, patientId],
      )
      return NextResponse.json(
        {
          error: {
            code: 'already_exists',
            message: 'A discharge summary already exists for this patient.',
            retryable: false,
          },
          summary: rows[0] ?? null,
        },
        { status: 409 },
      )
    }
    throw err
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id: patientId } = await params

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  // Refuse if no row exists.
  const cur = await pool.query(
    `SELECT id, status FROM ehr_discharge_summaries
      WHERE practice_id = $1 AND patient_id = $2 LIMIT 1`,
    [ctx.practiceId, patientId],
  )
  if (cur.rows.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  if (cur.rows[0].status !== 'draft') {
    return NextResponse.json(
      {
        error: {
          code: 'not_editable',
          message:
            'Completed discharge summaries cannot be edited. Create an amendment instead.',
          retryable: false,
        },
      },
      { status: 409 },
    )
  }

  const sets: string[] = []
  const args: unknown[] = []

  for (const k of TEXT_FIELDS) {
    if (k in body) {
      args.push(body[k] == null ? null : String(body[k]))
      sets.push(`${k} = $${args.length}`)
    }
  }
  if ('discharge_reason' in body) {
    const r = String(body.discharge_reason)
    if (!VALID_REASONS.has(r)) {
      return NextResponse.json(
        { error: { code: 'invalid_request', message: `discharge_reason must be one of ${[...VALID_REASONS].join(', ')}` } },
        { status: 400 },
      )
    }
    args.push(r)
    sets.push(`discharge_reason = $${args.length}`)
  }
  if ('discharged_at' in body && typeof body.discharged_at === 'string') {
    args.push(body.discharged_at)
    sets.push(`discharged_at = $${args.length}`)
  }
  if ('final_diagnoses' in body && Array.isArray(body.final_diagnoses)) {
    args.push(body.final_diagnoses.map((x) => String(x)))
    sets.push(`final_diagnoses = $${args.length}`)
  }

  if (sets.length === 0) {
    return NextResponse.json({ error: 'no fields to update' }, { status: 400 })
  }

  args.push(ctx.practiceId, patientId)
  const { rows } = await pool.query(
    `UPDATE ehr_discharge_summaries
        SET ${sets.join(', ')}
      WHERE practice_id = $${args.length - 1}
        AND patient_id  = $${args.length}
      RETURNING *`,
    args,
  )

  await auditEhrAccess({
    ctx,
    action: 'discharge_summary.updated',
    resourceType: 'ehr_discharge_summary',
    resourceId: rows[0].id,
    details: { patient_id: patientId, fields_changed: sets.map((s) => s.split(' ')[0]) },
  })

  return NextResponse.json({ summary: rows[0] })
}
