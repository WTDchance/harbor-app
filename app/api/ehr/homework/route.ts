// Therapist-side homework — list of homework assigned to patients.
// GET → list (optional ?patient_id= filter).
// POST → assign new homework. Single insert, audit-logged.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  if (!ctx.practiceId) return NextResponse.json({ homework: [] })

  const patientId = req.nextUrl.searchParams.get('patient_id')
  const conds: string[] = ['practice_id = $1']
  const args: unknown[] = [ctx.practiceId]
  if (patientId) { args.push(patientId); conds.push(`patient_id = $${args.length}`) }

  const { rows } = await pool.query(
    `SELECT id, patient_id, note_id, title, description, due_date,
            status, completed_at, completion_note, created_at
       FROM ehr_homework
      WHERE ${conds.join(' AND ')}
      ORDER BY created_at DESC LIMIT 200`,
    args,
  )

  return NextResponse.json({ homework: rows })
}

export async function POST(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const body = await req.json().catch(() => null) as any
  if (!body?.patient_id || !body?.title) {
    return NextResponse.json({ error: 'patient_id and title required' }, { status: 400 })
  }

  const { rows } = await pool.query(
    `INSERT INTO ehr_homework (
       practice_id, patient_id, note_id, title, description,
       due_date, status, created_by
     ) VALUES ($1, $2, $3, $4, $5, $6, 'assigned', $7)
     RETURNING *`,
    [
      ctx.practiceId, body.patient_id,
      body.note_id ?? null, body.title, body.description ?? null,
      body.due_date ?? null, ctx.user.id,
    ],
  )
  const homework = rows[0]

  await auditEhrAccess({
    ctx,
    action: 'note.update', // closest enum entry; refine if a homework.* action lands later
    resourceType: 'ehr_homework',
    resourceId: homework.id,
    details: { kind: 'homework_assign', patient_id: body.patient_id, title: body.title },
  })

  return NextResponse.json({ homework }, { status: 201 })
}
