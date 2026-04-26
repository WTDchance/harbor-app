// app/api/ehr/scheduling-requests/[id]/route.ts
//
// Wave 22 (AWS port). Therapist approves or declines a scheduling
// request. Approve creates an appointments row using the AWS
// canonical schedule_for timestamp (composed from date + time).

import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/aws/db'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const { id } = await params
  const body = await req.json().catch(() => null)
  const action = body?.action
  if (action !== 'approve' && action !== 'decline') {
    return NextResponse.json({ error: 'action must be approve | decline' }, { status: 400 })
  }

  const { rows: reqRows } = await pool.query(
    `SELECT * FROM ehr_scheduling_requests
      WHERE id = $1 AND practice_id = $2 LIMIT 1`,
    [id, ctx.practiceId],
  )
  const reqRow = reqRows[0]
  if (!reqRow) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (reqRow.status !== 'pending') {
    return NextResponse.json({ error: 'Already handled' }, { status: 409 })
  }

  if (action === 'decline') {
    try {
      const { rows } = await pool.query(
        `UPDATE ehr_scheduling_requests
            SET status = 'declined',
                therapist_note = $1,
                responded_at = NOW(),
                responded_by = $2
          WHERE id = $3
          RETURNING *`,
        [body?.note ?? null, ctx.user.id, id],
      )
      await auditEhrAccess({
        ctx,
        action: 'note.update',
        resourceType: 'ehr_scheduling_request',
        resourceId: id,
        details: { kind: 'scheduling_request_declined' },
      })
      return NextResponse.json({ request: rows[0] })
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 500 })
    }
  }

  // Approve — caller passes appointment_date + appointment_time, we compose
  // them into the AWS canonical scheduled_for timestamptz.
  const apptDate = body?.appointment_date
  const apptTime = body?.appointment_time
  if (!apptDate || !apptTime) {
    return NextResponse.json(
      { error: 'appointment_date and appointment_time required to approve' },
      { status: 400 },
    )
  }
  const time = apptTime.length === 5 ? apptTime + ':00' : apptTime
  const scheduledFor = `${apptDate}T${time}Z`
  if (Number.isNaN(new Date(scheduledFor).getTime())) {
    return NextResponse.json({ error: 'invalid date/time' }, { status: 400 })
  }

  const { rows: pRows } = await pool.query(
    `SELECT first_name, last_name, phone FROM patients
      WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [reqRow.patient_id],
  )
  const patient = pRows[0]

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const apptIns = await client.query(
      `INSERT INTO appointments
          (practice_id, patient_id, patient_name, patient_phone,
           scheduled_for, duration_minutes, appointment_type, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'scheduled')
        RETURNING *`,
      [
        ctx.practiceId,
        reqRow.patient_id,
        patient ? `${patient.first_name ?? ''} ${patient.last_name ?? ''}`.trim() : null,
        patient?.phone ?? null,
        scheduledFor,
        reqRow.duration_minutes,
        reqRow.appointment_type,
      ],
    )
    const appt = apptIns.rows[0]

    const updated = await client.query(
      `UPDATE ehr_scheduling_requests
          SET status = 'approved',
              appointment_id = $1,
              therapist_note = $2,
              responded_at = NOW(),
              responded_by = $3
        WHERE id = $4
        RETURNING *`,
      [appt.id, body?.note ?? null, ctx.user.id, id],
    )

    await client.query('COMMIT')

    await auditEhrAccess({
      ctx,
      action: 'note.update',
      resourceType: 'ehr_scheduling_request',
      resourceId: id,
      details: { kind: 'scheduling_request_approved', appointment_id: appt.id },
    })

    return NextResponse.json({ request: updated.rows[0], appointment: appt })
  } catch (err) {
    await client.query('ROLLBACK')
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  } finally {
    client.release()
  }
}
