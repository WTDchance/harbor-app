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
