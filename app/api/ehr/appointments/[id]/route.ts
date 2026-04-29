// app/api/ehr/appointments/[id]/route.ts
//
// Wave 38 TS1 — edit / delete appointments with RFC-5545 series semantics.
//
// PATCH body: {
//   scope: 'this_only' | 'this_and_future' | 'all',
//   patch: { scheduled_for?, duration_minutes?, appointment_type?, notes?, status? },
// }
//
// Semantics (mirror Apple Calendar / Google Calendar):
//   this_only       — detach this row from its series (clear
//                     recurrence_parent_id) and apply patch only to it.
//                     If the row IS the parent: also detach (its
//                     recurrence_rule is cleared so children are no
//                     longer regenerated, but existing children stay).
//   this_and_future — apply patch to this row and to all later rows in
//                     the same series. If this row is the parent we
//                     update everyone in the series.
//   all             — apply patch to the whole series (parent + all
//                     children).
//
// DELETE accepts ?scope= same values; semantics analogous.

import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/aws/db'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Scope = 'this_only' | 'this_and_future' | 'all'

const ALLOWED_PATCH_KEYS = new Set([
  'scheduled_for',
  'duration_minutes',
  'appointment_type',
  'notes',
  'status',
])

async function loadRow(id: string, practiceId: string) {
  const { rows } = await pool.query(
    `SELECT id, practice_id, recurrence_rule, recurrence_parent_id, scheduled_for
       FROM appointments
      WHERE id = $1 AND practice_id = $2 LIMIT 1`,
    [id, practiceId],
  )
  return rows[0] || null
}

async function siblingsInScope(row: any, scope: Scope, practiceId: string): Promise<string[]> {
  // Resolve the series id (parent of this row, or this row if it IS the parent).
  const seriesParentId: string =
    row.recurrence_parent_id || (row.recurrence_rule ? row.id : row.id)

  if (scope === 'all') {
    const { rows } = await pool.query(
      `SELECT id FROM appointments
        WHERE practice_id = $1
          AND (id = $2 OR recurrence_parent_id = $2)`,
      [practiceId, seriesParentId],
    )
    return rows.map(r => r.id)
  }
  if (scope === 'this_and_future') {
    const { rows } = await pool.query(
      `SELECT id FROM appointments
        WHERE practice_id = $1
          AND (id = $2 OR recurrence_parent_id = $2)
          AND scheduled_for >= $3`,
      [practiceId, seriesParentId, row.scheduled_for],
    )
    return rows.map(r => r.id)
  }
  // this_only
  return [row.id]
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  if (!ctx.practiceId) return NextResponse.json({ error: 'no_practice' }, { status: 403 })
  const { id } = await params

  const { rows } = await pool.query(
    `SELECT a.id, a.patient_id, a.scheduled_for, a.duration_minutes,
            a.appointment_type, a.status, a.notes,
            a.cpt_code, a.modifiers,
            a.recurrence_rule, a.recurrence_parent_id,
            a.event_type_id, a.location, a.completed_at,
            a.created_at, a.updated_at,
            p.first_name AS patient_first_name,
            p.last_name  AS patient_last_name,
            p.date_of_birth AS patient_dob,
            p.email AS patient_email,
            p.phone AS patient_phone,
            p.status AS patient_status,
            p.insurance_carrier AS insurance_carrier,
            p.insurance_member_id AS insurance_member_id,
            et.name AS event_type_name,
            et.color AS event_type_color,
            et.default_cpt_codes AS event_type_default_cpt
       FROM appointments a
       LEFT JOIN patients p ON p.id = a.patient_id
       LEFT JOIN calendar_event_types et ON et.id = a.event_type_id
      WHERE a.id = $1 AND a.practice_id = $2
      LIMIT 1`,
    [id, ctx.practiceId],
  )
  const appt = rows[0]
  if (!appt) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  // Latest signed/amended note for the patient
  let lastNote: any = null
  if (appt.patient_id) {
    const noteRes = await pool.query(
      `SELECT id, title, note_format, status, signed_at, cpt_codes, icd10_codes,
              subjective, objective, assessment, plan, body
         FROM ehr_progress_notes
        WHERE patient_id = $1 AND practice_id = $2
          AND status IN ('signed', 'amended')
        ORDER BY signed_at DESC NULLS LAST, created_at DESC
        LIMIT 1`,
      [appt.patient_id, ctx.practiceId],
    )
    lastNote = noteRes.rows[0] || null
  }

  // Active patient flags (Wave 49) — surface as `flags: string[]`.
  let flags: string[] = []
  if (appt.patient_id) {
    const flagsRes = await pool.query(
      `SELECT type FROM patient_flags
        WHERE patient_id = $1 AND practice_id = $2 AND cleared_at IS NULL`,
      [appt.patient_id, ctx.practiceId],
    ).catch(() => ({ rows: [] as any[] }))
    flags = flagsRes.rows.map((r: any) => r.type)
  }

  // Custom-form (intake) status: completed vs pending counts.
  let intake = { completed: 0, pending: 0 }
  if (appt.patient_id) {
    const intakeRes = await pool.query(
      `SELECT COUNT(*) FILTER (WHERE submitted_at IS NOT NULL) AS completed,
              COUNT(*) FILTER (WHERE submitted_at IS NULL)     AS pending
         FROM custom_form_responses
        WHERE patient_id = $1 AND practice_id = $2`,
      [appt.patient_id, ctx.practiceId],
    ).catch(() => ({ rows: [{ completed: 0, pending: 0 }] }))
    intake = {
      completed: Number(intakeRes.rows[0]?.completed ?? 0),
      pending:   Number(intakeRes.rows[0]?.pending   ?? 0),
    }
  }

  await auditEhrAccess({
    ctx,
    action: 'note.view',
    resourceType: 'appointment',
    resourceId: id,
    details: { surface: 'appointment_detail' },
    severity: 'info',
  })

  return NextResponse.json({ appointment: appt, last_note: lastNote, flags, intake })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id } = await params

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  const scope: Scope = (body.scope || 'this_only')
  if (!['this_only', 'this_and_future', 'all'].includes(scope)) {
    return NextResponse.json({ error: 'invalid scope' }, { status: 400 })
  }
  const patch = body.patch || {}
  const setKeys: string[] = []
  const setArgs: any[] = []
  for (const k of Object.keys(patch)) {
    if (!ALLOWED_PATCH_KEYS.has(k)) continue
    setArgs.push(patch[k])
    setKeys.push(`${k} = $${setArgs.length}`)
  }
  if (setKeys.length === 0) {
    return NextResponse.json({ error: 'no allowed fields in patch' }, { status: 400 })
  }

  const row = await loadRow(id, ctx.practiceId!)
  if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const ids = await siblingsInScope(row, scope, ctx.practiceId!)
  if (ids.length === 0) return NextResponse.json({ updated: 0 })

  // For this_only on a child, also detach.
  const detachThis = scope === 'this_only' && !!row.recurrence_parent_id
  const detachParentRule = scope === 'this_only' && !!row.recurrence_rule

  setArgs.push(...ids)
  const idPlaceholders = ids.map((_, i) => `$${setArgs.length - ids.length + 1 + i}`).join(',')
  const updateSql = `UPDATE appointments SET ${setKeys.join(', ')}, updated_at = NOW()
                      WHERE practice_id = $${setArgs.length + 1}
                        AND id IN (${idPlaceholders})
                      RETURNING id`
  setArgs.push(ctx.practiceId)
  const upd = await pool.query(updateSql, setArgs)

  if (detachThis) {
    await pool.query(
      `UPDATE appointments SET recurrence_parent_id = NULL WHERE id = $1 AND practice_id = $2`,
      [id, ctx.practiceId],
    )
  }
  if (detachParentRule) {
    await pool.query(
      `UPDATE appointments SET recurrence_rule = NULL WHERE id = $1 AND practice_id = $2`,
      [id, ctx.practiceId],
    )
  }

  await auditEhrAccess({
    ctx,
    action: 'note.update',
    resourceType: 'appointment',
    resourceId: id,
    details: { scope, patch_keys: Object.keys(patch).filter(k => ALLOWED_PATCH_KEYS.has(k)), updated: upd.rowCount },
  })

  // Wave 42 — when a therapist marks one or more rows as no_show, fire
  // the practice's no-show fee enforcement against each affected row.
  // Late-cancel fees are *not* fired from here because the constraint
  // says therapist-initiated cancellations don't trigger fees.
  if (patch.status === 'no_show' && upd.rowCount && upd.rowCount > 0) {
    try {
      const { enforceNoShowFee } = await import('@/lib/aws/ehr/cancellation-policy')
      for (const r of upd.rows) {
        await enforceNoShowFee(r.id, 'system')
      }
    } catch (err) {
      console.error('[ehr/appointments] no-show fee enforcement failed:', (err as Error).message)
    }
  }

  return NextResponse.json({ updated: upd.rowCount })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id } = await params
  const scope: Scope = (req.nextUrl.searchParams.get('scope') || 'this_only') as Scope
  if (!['this_only', 'this_and_future', 'all'].includes(scope)) {
    return NextResponse.json({ error: 'invalid scope' }, { status: 400 })
  }
  const row = await loadRow(id, ctx.practiceId!)
  if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const ids = await siblingsInScope(row, scope, ctx.practiceId!)
  if (ids.length === 0) return NextResponse.json({ deleted: 0 })

  const placeholders = ids.map((_, i) => `$${i + 2}`).join(',')
  const del = await pool.query(
    `DELETE FROM appointments WHERE practice_id = $1 AND id IN (${placeholders})`,
    [ctx.practiceId, ...ids],
  )

  await auditEhrAccess({
    ctx,
    action: 'note.delete',
    resourceType: 'appointment',
    resourceId: id,
    details: { scope, deleted: del.rowCount },
  })

  return NextResponse.json({ deleted: del.rowCount })
}
