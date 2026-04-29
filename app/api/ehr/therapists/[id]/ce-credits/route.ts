// W49 D3 — list + create CE credits.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
import { totalCeHours } from '@/lib/ehr/credentialing'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id: therapistId } = await params

  const sinceParam = req.nextUrl.searchParams.get('since')
  const since = sinceParam && /^\d{4}-\d{2}-\d{2}$/.test(sinceParam) ? sinceParam : null

  const args: any[] = [ctx.practiceId, therapistId]
  let cond = 'practice_id = $1 AND therapist_id = $2'
  if (since) { args.push(since); cond += ` AND completed_at >= $${args.length}` }

  const { rows } = await pool.query(
    `SELECT id, course_name, provider, hours, category, completed_at, cert_url, notes,
            created_at, updated_at
       FROM therapist_ce_credits
      WHERE ${cond}
      ORDER BY completed_at DESC`,
    args,
  )

  return NextResponse.json({
    credits: rows,
    total_hours: totalCeHours(rows),
  })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id: therapistId } = await params

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'invalid_json' }, { status: 400 })

  const tcheck = await pool.query(`SELECT 1 FROM therapists WHERE id = $1 AND practice_id = $2`, [therapistId, ctx.practiceId])
  if (tcheck.rows.length === 0) return NextResponse.json({ error: 'therapist_not_found' }, { status: 404 })

  const courseName = String(body.course_name ?? '').trim().slice(0, 200)
  if (!courseName) return NextResponse.json({ error: 'course_name_required' }, { status: 400 })

  const hours = Number(body.hours)
  if (!Number.isFinite(hours) || hours < 0 || hours > 1000) {
    return NextResponse.json({ error: 'invalid_hours' }, { status: 400 })
  }
  const completedAt = String(body.completed_at ?? '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(completedAt)) return NextResponse.json({ error: 'invalid_completed_at' }, { status: 400 })

  const ins = await pool.query(
    `INSERT INTO therapist_ce_credits
       (practice_id, therapist_id, course_name, provider, hours, category,
        completed_at, cert_url, notes, created_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING id, course_name, provider, hours, category, completed_at, cert_url, notes, created_at, updated_at`,
    [
      ctx.practiceId, therapistId, courseName, body.provider || null, hours,
      body.category || null, completedAt, body.cert_url || null, body.notes || null, ctx.user.id,
    ],
  )

  await auditEhrAccess({
    ctx, action: 'credential.ce_credit.create',
    resourceType: 'therapist_ce_credit', resourceId: ins.rows[0].id,
    details: { therapist_id: therapistId, hours, course_name: courseName },
  })

  return NextResponse.json({ credit: ins.rows[0] }, { status: 201 })
}
