// app/api/ehr/me/continuing-education/route.ts

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const year = Number(req.nextUrl.searchParams.get('year') || new Date().getUTCFullYear())

  const { rows } = await pool.query(
    `SELECT id, course_name, provider, completion_date::text,
            hours::float, certificate_url, audit_year, notes,
            created_at::text
       FROM ehr_continuing_education
      WHERE user_id = $1 AND audit_year = $2
      ORDER BY completion_date DESC`,
    [ctx.userId, year],
  )
  const totalHours = rows.reduce((s, r: any) => s + Number(r.hours || 0), 0)

  return NextResponse.json({ year, total_hours: totalHours, courses: rows })
}

export async function POST(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'invalid_json' }, { status: 400 })

  const courseName = String(body.course_name || '').trim()
  const completionDate = String(body.completion_date || '')
  const hours = Number(body.hours)
  if (!courseName || !/^\d{4}-\d{2}-\d{2}$/.test(completionDate) || !Number.isFinite(hours) || hours <= 0) {
    return NextResponse.json({ error: 'course_name + completion_date (YYYY-MM-DD) + hours required' }, { status: 400 })
  }

  const auditYear = body.audit_year ? Number(body.audit_year) : Number(completionDate.slice(0, 4))

  const ins = await pool.query(
    `INSERT INTO ehr_continuing_education
       (user_id, practice_id, course_name, provider, completion_date,
        hours, certificate_url, audit_year, notes, created_by)
     VALUES ($1, $2, $3, $4, $5::date, $6, $7, $8, $9, $1)
     RETURNING id, course_name, provider, completion_date::text,
               hours::float, certificate_url, audit_year, notes,
               created_at::text`,
    [
      ctx.userId, ctx.practiceId, courseName.slice(0, 300),
      body.provider ? String(body.provider).slice(0, 200) : null,
      completionDate, hours,
      body.certificate_url ? String(body.certificate_url).slice(0, 500) : null,
      auditYear,
      body.notes ? String(body.notes).slice(0, 1000) : null,
    ],
  )

  await auditEhrAccess({
    ctx,
    action: 'credentialing.ce_added',
    resourceType: 'ehr_continuing_education',
    resourceId: ins.rows[0].id,
    details: { audit_year: auditYear, hours },
  })
  return NextResponse.json({ course: ins.rows[0] }, { status: 201 })
}
