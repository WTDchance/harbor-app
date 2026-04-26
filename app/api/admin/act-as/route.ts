// app/api/admin/act-as/route.ts
//
// Wave 18 (AWS port). Super-admin "Act as Practice" endpoint. Sets the
// harbor_act_as_practice cookie so subsequent requests resolve that
// practice_id via getEffectivePracticeId() instead of the admin's own
// practice_id.
//
// Auth: requireAdminSession() — Cognito session must match
// ADMIN_EMAIL allowlist.
//
// POST   { practiceId: string }   → set cookie (8h TTL)
// DELETE                          → clear cookie (exit admin view)
// GET                             → returns current cookie + practice
//
// Audit captures: admin email + target practice_id + action + cookie
// expiry. The cookie itself is httpOnly + secure + sameSite=lax.

import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/aws/db'
import { requireAdminSession } from '@/lib/aws/api-auth'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
// Cookie name kept in sync with lib/active-practice (which still
// resolves it on the read side via getEffectivePracticeId).
const ACT_AS_COOKIE = 'harbor_act_as_practice'

const ACT_AS_TTL_SECONDS = 60 * 60 * 8 // 8 hours

export async function POST(req: NextRequest) {
  const ctx = await requireAdminSession()
  if (ctx instanceof NextResponse) return ctx

  let body: { practiceId?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const practiceId = body.practiceId?.trim()
  if (!practiceId) {
    return NextResponse.json({ error: 'practiceId required' }, { status: 400 })
  }

  const { rows } = await pool.query(
    `SELECT id, name FROM practices WHERE id = $1 LIMIT 1`,
    [practiceId],
  )
  if (rows.length === 0) {
    return NextResponse.json({ error: 'Practice not found' }, { status: 404 })
  }
  const practice = rows[0]

  const expiresAt = new Date(Date.now() + ACT_AS_TTL_SECONDS * 1000).toISOString()

  await auditEhrAccess({
    ctx,
    action: 'admin.act_as.set',
    resourceType: 'practice',
    resourceId: practice.id,
    details: {
      admin_email: ctx.session.email,
      target_practice_id: practice.id,
      target_practice_name: practice.name,
      cookie_expires_at: expiresAt,
    },
  })

  const res = NextResponse.json({ ok: true, practice })
  res.cookies.set(ACT_AS_COOKIE, practice.id, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: ACT_AS_TTL_SECONDS,
  })
  return res
}

export async function DELETE(_req: NextRequest) {
  const ctx = await requireAdminSession()
  if (ctx instanceof NextResponse) return ctx

  await auditEhrAccess({
    ctx,
    action: 'admin.act_as.clear',
    resourceType: 'practice',
    resourceId: null,
    details: { admin_email: ctx.session.email },
  })

  const res = NextResponse.json({ ok: true })
  res.cookies.set(ACT_AS_COOKIE, '', {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  })
  return res
}

export async function GET(req: NextRequest) {
  const ctx = await requireAdminSession()
  if (ctx instanceof NextResponse) return ctx

  const cookie = req.cookies.get(ACT_AS_COOKIE)?.value || null
  if (!cookie) {
    return NextResponse.json({ practiceId: null, practice: null })
  }
  const { rows } = await pool.query(
    `SELECT id, name FROM practices WHERE id = $1 LIMIT 1`,
    [cookie],
  )
  return NextResponse.json({ practiceId: cookie, practice: rows[0] ?? null })
}
