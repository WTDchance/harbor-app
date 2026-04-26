// app/api/therapists/[id]/route.ts
//
// Wave 23 (AWS port). PATCH any therapist field (display_name,
// credentials, bio, is_primary, is_active). DELETE = soft delete
// (is_active = false). Cognito session + practice via
// getEffectivePracticeId.

import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/aws/db'
import { requireApiSession } from '@/lib/aws/api-auth'
import { getEffectivePracticeId } from '@/lib/active-practice'

const BIO_SOFT_CAP = 1500

const UPDATABLE_TEXT = new Set(['display_name', 'credentials', 'bio'])

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id } = await params

  const practiceId = await getEffectivePracticeId(null, { email: ctx.session.email, id: ctx.user.id })
  if (!practiceId) return NextResponse.json({ error: 'Practice not found' }, { status: 404 })

  const { rows: existing } = await pool.query(
    `SELECT id, is_primary FROM therapists
      WHERE id = $1 AND practice_id = $2 LIMIT 1`,
    [id, practiceId],
  )
  if (existing.length === 0) {
    return NextResponse.json({ error: 'Therapist not found' }, { status: 404 })
  }

  const body = await req.json().catch(() => ({}))

  const sets: string[] = []
  const args: any[] = [id, practiceId]

  if (typeof body.display_name === 'string') {
    const trimmed = body.display_name.trim()
    if (!trimmed) return NextResponse.json({ error: 'display_name cannot be empty' }, { status: 400 })
    args.push(trimmed)
    sets.push(`display_name = $${args.length}`)
  }
  if ('credentials' in body) {
    const v = typeof body.credentials === 'string' && body.credentials.trim() !== ''
      ? body.credentials.trim() : null
    args.push(v)
    sets.push(`credentials = $${args.length}`)
  }
  if ('bio' in body) {
    let v = typeof body.bio === 'string' && body.bio.trim() !== '' ? body.bio.trim() : null
    if (v && v.length > BIO_SOFT_CAP) v = v.slice(0, BIO_SOFT_CAP)
    args.push(v)
    sets.push(`bio = $${args.length}`)
  }
  if (typeof body.is_active === 'boolean') {
    args.push(body.is_active)
    sets.push(`is_active = $${args.length}`)
  }
  if (typeof body.is_primary === 'boolean') {
    args.push(body.is_primary)
    sets.push(`is_primary = $${args.length}`)
    if (body.is_primary) {
      // Demote any current primary in same practice (best-effort).
      try {
        await pool.query(
          `UPDATE therapists SET is_primary = FALSE
            WHERE practice_id = $1 AND id <> $2 AND is_primary = TRUE`,
          [practiceId, id],
        )
      } catch {}
    }
  }

  if (sets.length === 0) {
    return NextResponse.json({ error: 'No updatable fields' }, { status: 400 })
  }

  try {
    const { rows } = await pool.query(
      `UPDATE therapists SET ${sets.join(', ')}
        WHERE id = $1 AND practice_id = $2
        RETURNING *`,
      args,
    )
    return NextResponse.json({ therapist: rows[0] })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id } = await params

  const practiceId = await getEffectivePracticeId(null, { email: ctx.session.email, id: ctx.user.id })
  if (!practiceId) return NextResponse.json({ error: 'Practice not found' }, { status: 404 })

  const { rowCount } = await pool.query(
    `UPDATE therapists SET is_active = FALSE
      WHERE id = $1 AND practice_id = $2`,
    [id, practiceId],
  )
  if ((rowCount ?? 0) === 0) {
    return NextResponse.json({ error: 'Therapist not found' }, { status: 404 })
  }
  return NextResponse.json({ ok: true, soft_deleted: true })
}
