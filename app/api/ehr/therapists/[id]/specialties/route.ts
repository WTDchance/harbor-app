// app/api/ehr/therapists/[id]/specialties/route.ts
//
// W49 D3 — list + create specialty chips.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id: therapistId } = await params

  const { rows } = await pool.query(
    `SELECT id, specialty, certified, cert_url, created_at
       FROM therapist_specialties
      WHERE practice_id = $1 AND therapist_id = $2
      ORDER BY specialty ASC`,
    [ctx.practiceId, therapistId],
  )
  return NextResponse.json({ specialties: rows })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id: therapistId } = await params

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'invalid_json' }, { status: 400 })

  const specialty = String(body.specialty ?? '').trim().slice(0, 80)
  if (!specialty) return NextResponse.json({ error: 'specialty_required' }, { status: 400 })

  const tcheck = await pool.query(`SELECT 1 FROM therapists WHERE id = $1 AND practice_id = $2`, [therapistId, ctx.practiceId])
  if (tcheck.rows.length === 0) return NextResponse.json({ error: 'therapist_not_found' }, { status: 404 })

  const ins = await pool.query(
    `INSERT INTO therapist_specialties (practice_id, therapist_id, specialty, certified, cert_url)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (therapist_id, specialty) DO UPDATE SET certified = EXCLUDED.certified, cert_url = EXCLUDED.cert_url
     RETURNING id, specialty, certified, cert_url, created_at`,
    [ctx.practiceId, therapistId, specialty, !!body.certified, body.cert_url || null],
  )

  await auditEhrAccess({
    ctx, action: 'credential.specialty.create',
    resourceType: 'therapist_specialty', resourceId: ins.rows[0].id,
    details: { therapist_id: therapistId, specialty },
  })

  return NextResponse.json({ specialty: ins.rows[0] }, { status: 201 })
}
