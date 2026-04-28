// app/api/ehr/clinical-tasks/[id]/route.ts
//
// W46 T3 — single-task operations.
//   PATCH  → update fields (title, description, due_at, kind, priority,
//            assigned_to_user_id, completed)
//   DELETE → hard-remove. No soft-delete; tasks are ephemeral by nature.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const KINDS = new Set(['patient_reminder', 'clinical_followup', 'admin', 'supervision', 'billing'])
const PRIORITIES = new Set(['low', 'normal', 'high'])

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'invalid_json' }, { status: 400 })

  // Pull the row first so we can detect a reassignment for audit.
  const cur = await pool.query(
    `SELECT assigned_to_user_id::text, completed_at
       FROM ehr_clinical_tasks
      WHERE id = $1 AND practice_id = $2 LIMIT 1`,
    [params.id, ctx.practiceId],
  )
  if (cur.rows.length === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const row = cur.rows[0]

  const fields: string[] = []
  const args: any[] = []
  let isReassign = false
  let isComplete = false

  if (body.title !== undefined) { args.push(String(body.title).slice(0, 200)); fields.push(`title = $${args.length}`) }
  if (body.description !== undefined) {
    args.push(body.description ? String(body.description).slice(0, 2000) : null)
    fields.push(`description = $${args.length}`)
  }
  if (body.due_at !== undefined) {
    const v = body.due_at ? new Date(body.due_at).toISOString() : null
    args.push(v); fields.push(`due_at = $${args.length}`)
  }
  if (body.kind !== undefined && KINDS.has(body.kind)) {
    args.push(body.kind); fields.push(`kind = $${args.length}`)
  }
  if (body.priority !== undefined && PRIORITIES.has(body.priority)) {
    args.push(body.priority); fields.push(`priority = $${args.length}`)
  }
  if (body.assigned_to_user_id !== undefined) {
    const newAssignee = String(body.assigned_to_user_id)
    if (newAssignee !== row.assigned_to_user_id) {
      const v = await pool.query(`SELECT 1 FROM users WHERE id = $1 AND practice_id = $2`, [newAssignee, ctx.practiceId])
      if (v.rows.length === 0) {
        return NextResponse.json({ error: 'assignee_not_in_practice' }, { status: 400 })
      }
      isReassign = true
    }
    args.push(newAssignee); fields.push(`assigned_to_user_id = $${args.length}`)
  }
  if (body.completed === true && !row.completed_at) {
    args.push(new Date().toISOString()); fields.push(`completed_at = $${args.length}`)
    args.push(ctx.userId); fields.push(`completed_by = $${args.length}`)
    isComplete = true
  }
  if (body.completed === false) {
    fields.push(`completed_at = NULL`)
    fields.push(`completed_by = NULL`)
  }

  if (fields.length === 0) return NextResponse.json({ error: 'no_fields' }, { status: 400 })

  args.push(params.id, ctx.practiceId)
  const { rows } = await pool.query(
    `UPDATE ehr_clinical_tasks SET ${fields.join(', ')}
      WHERE id = $${args.length - 1} AND practice_id = $${args.length}
      RETURNING id, assigned_to_user_id::text, patient_id::text, title,
                description, due_at, completed_at, kind, priority, created_at`,
    args,
  )

  if (isComplete) {
    await auditEhrAccess({
      ctx, action: 'clinical_task.completed',
      resourceType: 'ehr_clinical_task', resourceId: params.id,
      details: { kind: rows[0].kind },
    })
  } else if (isReassign) {
    await auditEhrAccess({
      ctx, action: 'clinical_task.reassigned',
      resourceType: 'ehr_clinical_task', resourceId: params.id,
      details: { kind: rows[0].kind },
    })
  } else {
    await auditEhrAccess({
      ctx, action: 'clinical_task.updated',
      resourceType: 'ehr_clinical_task', resourceId: params.id,
      details: { fields_changed: fields.length },
    })
  }

  return NextResponse.json({ task: rows[0] })
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const { rowCount } = await pool.query(
    `DELETE FROM ehr_clinical_tasks WHERE id = $1 AND practice_id = $2`,
    [params.id, ctx.practiceId],
  )
  if (rowCount === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  await auditEhrAccess({
    ctx, action: 'clinical_task.updated',
    resourceType: 'ehr_clinical_task', resourceId: params.id,
    details: { deleted: true },
  })
  return NextResponse.json({ ok: true })
}
