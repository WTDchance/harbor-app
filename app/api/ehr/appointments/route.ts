// app/api/ehr/appointments/route.ts
//
// Wave 38 TS1 — therapist-side appointment create.
// Body:
//   {
//     patient_id,
//     scheduled_for: ISO,   // UTC
//     duration_minutes,
//     appointment_type,
//     notes?,
//     recurrence: 'none' | 'weekly' | 'biweekly' | 'monthly' | <RRULE>,
//     occurrences?: number  // override default 12
//   }
//
// On `recurrence` other than 'none' we materialize the next N occurrences
// (default 12) as child rows pointing back to the parent via
// recurrence_parent_id. The parent itself owns the recurrence_rule.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
import { presetToRrule, parseRrule, expand } from '@/lib/aws/ehr/recurrence'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  if (!ctx.practiceId) return NextResponse.json({ appointments: [] })

  const from = req.nextUrl.searchParams.get('from')
  const to = req.nextUrl.searchParams.get('to')

  const args: any[] = [ctx.practiceId]
  let where = `practice_id = $1`
  if (from) { args.push(from); where += ` AND scheduled_for >= $${args.length}` }
  if (to)   { args.push(to);   where += ` AND scheduled_for <= $${args.length}` }

  const { rows } = await pool.query(
    `SELECT id, patient_id, scheduled_for, duration_minutes, appointment_type,
            status, recurrence_rule, recurrence_parent_id, notes
       FROM appointments
      WHERE ${where}
      ORDER BY scheduled_for ASC LIMIT 500`,
    args,
  )
  return NextResponse.json({ appointments: rows })
}

export async function POST(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  if (!ctx.practiceId) return NextResponse.json({ error: 'no_practice' }, { status: 403 })

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'invalid json' }, { status: 400 })

  const patientId = String(body.patient_id || '')
  const scheduledFor = String(body.scheduled_for || '')
  const duration = Math.max(5, Math.min(480, parseInt(body.duration_minutes || '50', 10)))
  const apptType = String(body.appointment_type || 'follow_up')
  const notes = body.notes ? String(body.notes) : null
  const recurrence = String(body.recurrence || 'none')
  const occurrencesCap = Math.max(1, Math.min(52, parseInt(body.occurrences || '12', 10) || 12))

  if (!patientId) return NextResponse.json({ error: 'patient_id required' }, { status: 400 })
  const startDate = new Date(scheduledFor)
  if (Number.isNaN(startDate.getTime())) {
    return NextResponse.json({ error: 'invalid scheduled_for' }, { status: 400 })
  }

  const rrule = presetToRrule(recurrence)

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // Verify patient
    const pCheck = await client.query(
      `SELECT id, first_name, last_name, phone FROM patients
        WHERE id = $1 AND practice_id = $2 LIMIT 1`,
      [patientId, ctx.practiceId],
    )
    const patient = pCheck.rows[0]
    if (!patient) {
      await client.query('ROLLBACK')
      return NextResponse.json({ error: 'patient_not_found' }, { status: 404 })
    }

    // Insert parent
    const parentRes = await client.query(
      `INSERT INTO appointments
         (practice_id, patient_id, patient_name, patient_phone,
          scheduled_for, duration_minutes, appointment_type, status,
          recurrence_rule, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'scheduled', $8, $9)
       RETURNING *`,
      [
        ctx.practiceId,
        patientId,
        `${patient.first_name ?? ''} ${patient.last_name ?? ''}`.trim() || null,
        patient.phone ?? null,
        startDate.toISOString(),
        duration,
        apptType,
        rrule,
        notes,
      ],
    )
    const parent = parentRes.rows[0]

    let children: any[] = []
    if (rrule) {
      const parsed = parseRrule(rrule)
      if (parsed) {
        // expand returns the parent as occurrence[0]; skip it.
        const occ = expand(startDate, parsed, occurrencesCap).slice(1)
        for (const o of occ) {
          const child = await client.query(
            `INSERT INTO appointments
               (practice_id, patient_id, patient_name, patient_phone,
                scheduled_for, duration_minutes, appointment_type, status,
                recurrence_parent_id, notes)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'scheduled', $8, $9)
             RETURNING *`,
            [
              ctx.practiceId,
              patientId,
              `${patient.first_name ?? ''} ${patient.last_name ?? ''}`.trim() || null,
              patient.phone ?? null,
              o.startUtcIso,
              duration,
              apptType,
              parent.id,
              notes,
            ],
          )
          children.push(child.rows[0])
        }
      }
    }

    await client.query('COMMIT')

    await auditEhrAccess({
      ctx,
      action: 'note.create',
      resourceType: 'appointment',
      resourceId: parent.id,
      details: {
        kind: 'appointment_created',
        recurrence_rule: rrule,
        children_created: children.length,
      },
    })

    return NextResponse.json({ appointment: parent, occurrences: [parent, ...children] }, { status: 201 })
  } catch (err) {
    try { await client.query('ROLLBACK') } catch {}
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  } finally {
    client.release()
  }
}
