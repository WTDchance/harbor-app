// app/api/ehr/appointments/[id]/patients/[linkId]/route.ts
//
// Wave 41 / T2 — update + remove an attendee link.
// PATCH allows toggling `present` and editing role. DELETE removes
// the row but RESTRICTs removal of the primary attendee — that's
// the legacy patient_id anchor and removing it would leave the
// appointment without a primary patient.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ROLES = new Set(['primary','attendee','partner','parent','child','sibling','support','other'])

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; linkId: string }> },
) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id: appointmentId, linkId } = await params

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const sets: string[] = []
  const args: unknown[] = []
  if (typeof body.present === 'boolean') {
    args.push(body.present); sets.push(`present = $${args.length}`)
  }
  if (typeof body.role === 'string' && ROLES.has(body.role)) {
    args.push(body.role); sets.push(`role = $${args.length}`)
  }
  if (sets.length === 0) {
    return NextResponse.json({ error: 'no fields to update' }, { status: 400 })
  }

  args.push(ctx.practiceId, appointmentId, linkId)
  const { rows } = await pool.query(
    `UPDATE ehr_appointment_patients
        SET ${sets.join(', ')}
      WHERE practice_id     = $${args.length - 2}
        AND appointment_id  = $${args.length - 1}
        AND id              = $${args.length}
      RETURNING *`,
    args,
  )
  if (!rows[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await auditEhrAccess({
    ctx,
    action: 'appointment.patient.added', // role/present change is functionally an update of the link
    resourceType: 'ehr_appointment_patient',
    resourceId: linkId,
    details: { appointment_id: appointmentId, fields_changed: sets.map((s) => s.split(' ')[0]) },
  })

  return NextResponse.json({ attendee: rows[0] })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; linkId: string }> },
) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id: appointmentId, linkId } = await params

  // Refuse to delete the primary attendee — that's the legacy
  // appointments.patient_id anchor; removing it would leave the
  // appointment dangling. Operators who want to swap the primary
  // should update the appointment row's patient_id directly.
  const cur = await pool.query(
    `SELECT role, patient_id FROM ehr_appointment_patients
      WHERE practice_id = $1 AND appointment_id = $2 AND id = $3 LIMIT 1`,
    [ctx.practiceId, appointmentId, linkId],
  )
  if (cur.rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (cur.rows[0].role === 'primary') {
    return NextResponse.json(
      {
        error: {
          code: 'cannot_remove_primary',
          message: 'Cannot remove the primary attendee. Update the appointment\'s patient_id to swap.',
        },
      },
      { status: 409 },
    )
  }

  await pool.query(
    `DELETE FROM ehr_appointment_patients
      WHERE practice_id = $1 AND appointment_id = $2 AND id = $3`,
    [ctx.practiceId, appointmentId, linkId],
  )

  await auditEhrAccess({
    ctx,
    action: 'appointment.patient.removed',
    resourceType: 'ehr_appointment_patient',
    resourceId: linkId,
    details: { appointment_id: appointmentId, patient_id: cur.rows[0].patient_id },
  })

  return NextResponse.json({ removed: true })
}
