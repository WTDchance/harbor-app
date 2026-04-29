// app/api/ehr/therapists/[id]/licenses/route.ts
//
// W49 D3 — list + create therapist licenses.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
import { LICENSE_STATUSES, normaliseState } from '@/lib/ehr/credentialing'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function requireTherapist(ctx: { practiceId: string | null }, therapistId: string) {
  const r = await pool.query(
    `SELECT id FROM therapists WHERE id = $1 AND practice_id = $2 LIMIT 1`,
    [therapistId, ctx.practiceId],
  )
  return r.rows.length > 0
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id: therapistId } = await params
  if (!(await requireTherapist(ctx, therapistId))) return NextResponse.json({ error: 'therapist_not_found' }, { status: 404 })

  const { rows } = await pool.query(
    `SELECT id, type, state, license_number, issued_at, expires_at, status,
            document_url, notes, last_warning_threshold, created_at, updated_at
       FROM therapist_licenses
      WHERE practice_id = $1 AND therapist_id = $2
      ORDER BY expires_at NULLS LAST, created_at DESC`,
    [ctx.practiceId, therapistId],
  )

  await auditEhrAccess({
    ctx, action: 'credential.list',
    resourceType: 'therapist_license', details: { therapist_id: therapistId, count: rows.length },
  })

  return NextResponse.json({ licenses: rows })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id: therapistId } = await params
  if (!(await requireTherapist(ctx, therapistId))) return NextResponse.json({ error: 'therapist_not_found' }, { status: 404 })

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'invalid_json' }, { status: 400 })

  const type = String(body.type ?? '').trim().slice(0, 30)
  if (!type) return NextResponse.json({ error: 'type_required' }, { status: 400 })
  const state = normaliseState(body.state)
  if (!state) return NextResponse.json({ error: 'invalid_state' }, { status: 400 })
  const number = String(body.license_number ?? '').trim().slice(0, 60)
  if (!number) return NextResponse.json({ error: 'license_number_required' }, { status: 400 })
  const status = LICENSE_STATUSES.includes(body.status) ? body.status : 'active'

  const ins = await pool.query(
    `INSERT INTO therapist_licenses
       (practice_id, therapist_id, type, state, license_number,
        issued_at, expires_at, status, document_url, notes, created_by_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id, type, state, license_number, issued_at, expires_at, status,
               document_url, notes, last_warning_threshold, created_at, updated_at`,
    [
      ctx.practiceId, therapistId, type, state, number,
      body.issued_at || null, body.expires_at || null, status,
      body.document_url || null, body.notes || null, ctx.user.id,
    ],
  )

  await auditEhrAccess({
    ctx, action: 'credential.license.create',
    resourceType: 'therapist_license', resourceId: ins.rows[0].id,
    details: { therapist_id: therapistId, type, state },
  })

  return NextResponse.json({ license: ins.rows[0] }, { status: 201 })
}
