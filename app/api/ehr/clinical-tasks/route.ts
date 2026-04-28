// app/api/ehr/clinical-tasks/route.ts
//
// W46 T3 — list + create clinical tasks.
//
// Query params on GET:
//   patient_id    — narrow to a single patient (used by the Tasks tab)
//   assignee      — 'me' | <userId>. Default 'me'.
//   completed     — 'true' | 'false'. Default 'false'.
//   due_within    — '24h' | '7d' | 'all'. Default '7d'.
//
// POST body:
//   { title, description?, due_at?, kind?, priority?, patient_id?, assigned_to_user_id? }
//   assigned_to_user_id defaults to ctx.userId (self-assigned).

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const KINDS = new Set(['patient_reminder', 'clinical_followup', 'admin', 'supervision', 'billing'])
const PRIORITIES = new Set(['low', 'normal', 'high'])

export async function GET(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const sp = req.nextUrl.searchParams
  const patientId = sp.get('patient_id')
  const assigneeParam = sp.get('assignee') || 'me'
  const completed = sp.get('completed') === 'true'
  const dueWithin = sp.get('due_within') || '7d'

  const conds: string[] = ['practice_id = $1']
  const args: any[] = [ctx.practiceId]

  if (patientId) {
    args.push(patientId)
    conds.push(`patient_id = $${args.length}`)
  }

  if (assigneeParam === 'me') {
    args.push(ctx.userId)
    conds.push(`assigned_to_user_id = $${args.length}`)
  } else if (assigneeParam !== 'all') {
    args.push(assigneeParam)
    conds.push(`assigned_to_user_id = $${args.length}`)
  }

  if (completed) {
    conds.push(`completed_at IS NOT NULL`)
  } else {
    conds.push(`completed_at IS NULL`)
  }

  if (!completed && !patientId) {
    if (dueWithin === '24h') conds.push(`(due_at IS NULL OR due_at <= NOW() + INTERVAL '24 hours')`)
    else if (dueWithin === '7d') conds.push(`(due_at IS NULL OR due_at <= NOW() + INTERVAL '7 days')`)
    // 'all' — no extra filter
  }

  const { rows } = await pool.query(
    `SELECT t.id, t.assigned_to_user_id::text, t.patient_id::text,
            t.title, t.description, t.due_at, t.completed_at,
            t.kind, t.priority, t.created_at,
            p.first_name AS patient_first_name,
            p.last_name  AS patient_last_name,
            u.email      AS assignee_email
       FROM ehr_clinical_tasks t
       LEFT JOIN patients p ON p.id = t.patient_id
       LEFT JOIN users u    ON u.id = t.assigned_to_user_id
      WHERE ${conds.join(' AND ')}
      ORDER BY
        CASE t.priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
        t.due_at NULLS LAST,
        t.created_at DESC
      LIMIT 200`,
    args,
  )

  return NextResponse.json({ tasks: rows })
}

export async function POST(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'invalid_json' }, { status: 400 })

  const title = String(body.title || '').trim()
  if (!title) return NextResponse.json({ error: 'title required' }, { status: 400 })

  const description = body.description ? String(body.description).slice(0, 2000) : null
  const dueAt = body.due_at ? new Date(body.due_at).toISOString() : null
  const kind = KINDS.has(body.kind) ? body.kind : 'clinical_followup'
  const priority = PRIORITIES.has(body.priority) ? body.priority : 'normal'
  const patientId = body.patient_id ? String(body.patient_id) : null
  const assignee = body.assigned_to_user_id ? String(body.assigned_to_user_id) : ctx.userId

  // Verify assignee is in this practice.
  const assigneeRow = await pool.query(
    `SELECT 1 FROM users WHERE id = $1 AND practice_id = $2`,
    [assignee, ctx.practiceId],
  )
  if (assigneeRow.rows.length === 0) {
    return NextResponse.json({ error: 'assignee_not_in_practice' }, { status: 400 })
  }

  // Verify patient if supplied.
  if (patientId) {
    const pRow = await pool.query(
      `SELECT 1 FROM patients WHERE id = $1 AND practice_id = $2`,
      [patientId, ctx.practiceId],
    )
    if (pRow.rows.length === 0) {
      return NextResponse.json({ error: 'patient_not_in_practice' }, { status: 400 })
    }
  }

  const ins = await pool.query(
    `INSERT INTO ehr_clinical_tasks
       (practice_id, assigned_to_user_id, patient_id, title, description,
        due_at, kind, priority, created_by_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, assigned_to_user_id::text, patient_id::text,
               title, description, due_at, completed_at,
               kind, priority, created_at`,
    [ctx.practiceId, assignee, patientId, title, description, dueAt, kind, priority, ctx.userId],
  )

  await auditEhrAccess({
    ctx,
    action: 'clinical_task.created',
    resourceType: 'ehr_clinical_task',
    resourceId: ins.rows[0].id,
    details: {
      kind, priority,
      has_patient: !!patientId,
      has_due_date: !!dueAt,
      self_assigned: assignee === ctx.userId,
    },
  })

  return NextResponse.json({ task: ins.rows[0] }, { status: 201 })
}
