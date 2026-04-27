// app/api/ehr/appointments/[id]/patients/route.ts
//
// Wave 41 / T2 — list + add attendees on a multi-patient appointment.
// The legacy appointments.patient_id stays as the primary anchor;
// this endpoint manages the M:N join table.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ROLES = new Set(['primary','attendee','partner','parent','child','sibling','support','other'])

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id: appointmentId } = await params

  const { rows } = await pool.query(
    `SELECT ap.*,
            p.first_name, p.last_name
       FROM ehr_appointment_patients ap
       LEFT JOIN patients p ON p.id = ap.patient_id
      WHERE ap.practice_id = $1 AND ap.appointment_id = $2
      ORDER BY (ap.role = 'primary') DESC, p.last_name ASC`,
    [ctx.practiceId, appointmentId],
  )

  await auditEhrAccess({
    ctx,
    action: 'appointment.patient.list',
    resourceType: 'ehr_appointment_patients',
    resourceId: appointmentId,
    details: { count: rows.length },
  })

  return NextResponse.json({ attendees: rows })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id: appointmentId } = await params

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const patientId = typeof body.patient_id === 'string' ? body.patient_id : ''
  const role = typeof body.role === 'string' && ROLES.has(body.role) ? body.role : 'attendee'
  const present = body.present === false ? false : true
  if (!patientId) {
    return NextResponse.json({ error: { code: 'invalid_request', message: 'patient_id required' } }, { status: 400 })
  }

  // Verify appointment belongs to this practice.
  const ap = await pool.query(
    `SELECT id FROM appointments WHERE practice_id = $1 AND id = $2 LIMIT 1`,
    [ctx.practiceId, appointmentId],
  )
  if (ap.rows.length === 0) return NextResponse.json({ error: 'Appointment not found' }, { status: 404 })

  try {
    const { rows } = await pool.query(
      `INSERT INTO ehr_appointment_patients
         (appointment_id, practice_id, patient_id, role, present)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [appointmentId, ctx.practiceId, patientId, role, present],
    )

    await auditEhrAccess({
      ctx,
      action: 'appointment.patient.added',
      resourceType: 'ehr_appointment_patient',
      resourceId: rows[0].id,
      details: { appointment_id: appointmentId, patient_id: patientId, role, present },
    })

    return NextResponse.json({ attendee: rows[0] }, { status: 201 })
  } catch (err: any) {
    if (err?.code === '23505') {
      return NextResponse.json(
        { error: { code: 'duplicate', message: 'Patient is already an attendee on this appointment.' } },
        { status: 409 },
      )
    }
    throw err
  }
}
