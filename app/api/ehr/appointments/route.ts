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
import { findActiveAuth, computeWarning, consumeAuthSession } from '@/lib/aws/ehr/authorizations'
import { presetToRrule, parseRrule, expand, tzOffsetMinutes } from '@/lib/aws/ehr/recurrence'
import { usFederalHolidays, mergeHolidayLists, type HolidayInfo } from '@/lib/aws/ehr/holidays'

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
            status, recurrence_rule, recurrence_parent_id, notes,
            cpt_code, modifiers
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
  const cptCode = body.cpt_code ? String(body.cpt_code) : null
  // Auto-attach CMS modifier 95 (synchronous interactive telehealth)
  // whenever the appointment is booked as telehealth — TS6.
  const isTelehealth = apptType === 'telehealth' || body.is_telehealth === true
  const explicitModifiers: string[] = Array.isArray(body.modifiers)
    ? body.modifiers.map((m: any) => String(m)).filter(Boolean)
    : []
  const modifierSet = new Set<string>(explicitModifiers)
  if (isTelehealth) modifierSet.add('95')
  const modifiers = Array.from(modifierSet)
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

    // W43 T1 — practice timezone + holiday list. Used to preserve the
    // patient's local clock time across DST and to flag occurrences that
    // land on a US federal or practice-custom holiday. Default to UTC if
    // somehow null (older rows pre-migration) so we never crash.
    const tzRes = await client.query(
      `SELECT COALESCE(timezone, 'UTC') AS tz
         FROM practices WHERE id = $1 LIMIT 1`,
      [ctx.practiceId],
    )
    const practiceTz: string = tzRes.rows[0]?.tz || 'UTC'

    // Build the holiday set once (federal for the next 2 years +
    // practice-custom rows). The expander cap is 52, so two years of
    // federal holidays plus custom is more than enough headroom.
    const horizonYear = startDate.getUTCFullYear()
    const customRes = await client.query(
      `SELECT holiday_date::text AS date, name FROM ehr_practice_holidays
        WHERE practice_id = $1
          AND holiday_date >= ($2::date - INTERVAL '7 days')
          AND holiday_date <  ($2::date + INTERVAL '2 years')`,
      [ctx.practiceId, startDate.toISOString().slice(0, 10)],
    )
    const customHolidays: HolidayInfo[] = customRes.rows.map((r: any) => ({
      date: String(r.date).slice(0, 10),
      name: String(r.name || 'Practice holiday'),
    }))
    const holidaySet = new Set<string>(
      mergeHolidayLists(
        [...usFederalHolidays(horizonYear), ...usFederalHolidays(horizonYear + 1)],
        customHolidays,
      ).map((h) => h.date),
    )

    /** Convert a UTC date to the YYYY-MM-DD string in the practice's tz. */
    function localDateInPracticeTz(d: Date): string {
      try {
        const fmt = new Intl.DateTimeFormat('en-CA', {
          timeZone: practiceTz,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        })
        // en-CA with 2-digit parts → "YYYY-MM-DD"
        return fmt.format(d)
      } catch {
        return d.toISOString().slice(0, 10)
      }
    }

    const parentLocalDate = localDateInPracticeTz(startDate)
    const parentHoliday = holidaySet.has(parentLocalDate)

    // Insert parent
    const parentRes = await client.query(
      `INSERT INTO appointments
         (practice_id, patient_id, patient_name, patient_phone,
          scheduled_for, duration_minutes, appointment_type, status,
          recurrence_rule, notes, cpt_code, modifiers,
          holiday_exception, dst_adjusted)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'scheduled', $8, $9, $10, $11, $12, FALSE)
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
        cptCode,
        modifiers,
        parentHoliday,
      ],
    )
    const parent = parentRes.rows[0]

    let children: any[] = []
    if (rrule) {
      const parsed = parseRrule(rrule)
      if (parsed) {
        // expand returns the parent as occurrence[0]; skip it.
        // Pass practiceTz so the expander preserves local clock time
        // across DST transitions and flags shifted occurrences.
        const occ = expand(startDate, parsed, occurrencesCap, practiceTz).slice(1)
        for (const o of occ) {
          const localDate = localDateInPracticeTz(new Date(o.startUtcIso))
          const isHoliday = holidaySet.has(localDate)
          const child = await client.query(
            `INSERT INTO appointments
               (practice_id, patient_id, patient_name, patient_phone,
                scheduled_for, duration_minutes, appointment_type, status,
                recurrence_parent_id, notes, cpt_code, modifiers,
                holiday_exception, dst_adjusted)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'scheduled', $8, $9, $10, $11, $12, $13)
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
              cptCode,
              modifiers,
              isHoliday,
              !!o.dstAdjusted,
            ],
          )
          children.push(child.rows[0])
        }
      }
    }

    await client.query('COMMIT')

    // Wave 40 / P1 — best-effort insurance authorization consumption.
    // Runs AFTER the transaction commits so an auth-side-effect hiccup
    // never blocks scheduling. Surfaces warnings in the response so the
    // UI can flag low/expired/exhausted auths inline.
    type ApptAuthWarning = {
      appointment_id: string
      auth_id: string | null
      warning: 'low' | 'expired' | 'exhausted' | null
      message: string | null
    }
    const appointmentWarnings: ApptAuthWarning[] = []
    const apptsToCheck = [parent, ...children]
    for (const a of apptsToCheck) {
      try {
        const auth = await findActiveAuth({
          practiceId: ctx.practiceId!,
          patientId: a.patient_id,
          cptCode: a.cpt_code ?? null,
          scheduledFor: a.scheduled_for,
        })
        if (!auth) continue
        const { warning, message } = computeWarning(auth, a.scheduled_for)
        // Don't consume against an already-exhausted or expired auth.
        if (warning !== 'exhausted' && warning !== 'expired') {
          const post = await consumeAuthSession({ authId: auth.id })
          await auditEhrAccess({
            ctx,
            action: 'insurance_authorization.used',
            resourceType: 'ehr_insurance_authorization',
            resourceId: auth.id,
            details: {
              appointment_id: a.id,
              patient_id: a.patient_id,
              cpt_code: a.cpt_code ?? null,
              scheduled_for: a.scheduled_for,
              sessions_used_after: post?.sessions_used ?? null,
              sessions_authorized: post?.sessions_authorized ?? null,
            },
          })
        }
        if (warning) {
          appointmentWarnings.push({
            appointment_id: a.id,
            auth_id: auth.id,
            warning,
            message,
          })
        }
      } catch (err) {
        // Auth bookkeeping must never break scheduling.
        console.error('[appointments] auth consumption failed:', (err as Error).message)
      }
    }

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

    // W43 T1 — best-effort audit signals when recurrence expansion
    // tripped DST or landed on a holiday. Emit count-only details so we
    // don't leak appointment dates/PHI into audit_logs (W41 T0 cleanup).
    const dstCount =
      (parent.dst_adjusted ? 1 : 0) +
      children.reduce((n, c: any) => n + (c.dst_adjusted ? 1 : 0), 0)
    const holidayCount =
      (parent.holiday_exception ? 1 : 0) +
      children.reduce((n, c: any) => n + (c.holiday_exception ? 1 : 0), 0)
    if (dstCount > 0) {
      await auditEhrAccess({
        ctx,
        action: 'recurrence.dst_adjusted',
        resourceType: 'appointment',
        resourceId: parent.id,
        details: { adjusted_count: dstCount, total_occurrences: 1 + children.length },
      })
    }
    if (holidayCount > 0) {
      await auditEhrAccess({
        ctx,
        action: 'recurrence.holiday_exception_flagged',
        resourceType: 'appointment',
        resourceId: parent.id,
        details: { holiday_count: holidayCount, total_occurrences: 1 + children.length },
      })
    }

    return NextResponse.json(
      {
        appointment: parent,
        occurrences: [parent, ...children],
        appointment_warnings: appointmentWarnings,
      },
      { status: 201 },
    )
  } catch (err) {
    try { await client.query('ROLLBACK') } catch {}
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  } finally {
    client.release()
  }
}
