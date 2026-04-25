// HIPAA Audit Log API — §164.312(b).
//
// POST: any caller can append an audit event (login_failed events come in
//       pre-auth, so we use the permissive getApiSession() and let the body
//       override practice_id for service-side logging).
// GET:  practice-scoped read, requires authenticated user.

import { NextResponse, type NextRequest } from 'next/server'
import { requireApiSession, getApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { checkBruteForce } from '@/lib/breach-detection'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function getClientIp(req: NextRequest): string | null {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    null
  )
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as any
  if (!body?.action) {
    return NextResponse.json({ error: 'action is required' }, { status: 400 })
  }

  const { action, resource_type, resource_id, details, severity } = body

  // Resolve the calling user (if authenticated). Anonymous events are fine.
  const ctx = await getApiSession()
  let userId: string | null = ctx?.user.id ?? null
  let userEmail: string | null = ctx?.session.email ?? null
  let practiceId: string | null = ctx?.practiceId ?? null

  // Service-side callers can override practice_id (e.g. webhooks logging on
  // behalf of a known practice without an authenticated session).
  if (body.practice_id) practiceId = body.practice_id

  try {
    await pool.query(
      `INSERT INTO audit_logs (
         user_id, user_email, practice_id, action, resource_type, resource_id,
         details, ip_address, user_agent, severity
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7::jsonb, $8::inet, $9, $10
       )`,
      [
        userId, userEmail, practiceId, action,
        resource_type ?? null, resource_id ?? null,
        JSON.stringify(details ?? {}),
        getClientIp(req), req.headers.get('user-agent') || null,
        severity || 'info',
      ],
    )
  } catch (err) {
    console.error('[audit-log] insert error:', (err as Error).message)
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 })
  }

  // Brute-force detection on failed logins. Fire-and-forget.
  if (action === 'login_failed') {
    const clientIp = getClientIp(req)
    if (clientIp) {
      checkBruteForce(clientIp, req.headers.get('user-agent')).catch(() => {})
    }
  }

  return NextResponse.json({ ok: true })
}

export async function GET(req: NextRequest) {
  const ctx = await requireApiSession()
  if (ctx instanceof NextResponse) return ctx
  if (!ctx.practiceId) return NextResponse.json({ logs: [], total: 0 })

  const sp = req.nextUrl.searchParams
  const limit = Math.min(Number(sp.get('limit') ?? 100), 500)
  const offset = Math.max(Number(sp.get('offset') ?? 0), 0)
  const actionFilter = sp.get('action')

  const conds: string[] = ['practice_id = $1']
  const args: unknown[] = [ctx.practiceId]
  if (actionFilter) { args.push(actionFilter); conds.push(`action = $${args.length}`) }

  const where = conds.join(' AND ')
  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total FROM audit_logs WHERE ${where}`,
    args,
  )
  args.push(limit, offset)
  const logsResult = await pool.query(
    `SELECT * FROM audit_logs
      WHERE ${where}
      ORDER BY timestamp DESC
      LIMIT $${args.length - 1} OFFSET $${args.length}`,
    args,
  )

  return NextResponse.json({
    logs: logsResult.rows,
    total: countResult.rows[0]?.total ?? 0,
  })
}
