// W52 D4 — mark a remittance as disputed.
import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { writeAuditLog } from '@/lib/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id } = await params
  const body = await req.json().catch(() => null) as { reason?: string } | null

  const upd = await pool.query(
    `UPDATE era_remittances SET status = 'disputed' WHERE id = $1 AND practice_id = $2 RETURNING id`,
    [id, ctx.practiceId],
  )
  if (upd.rows.length === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  await writeAuditLog({
    practice_id: ctx.practiceId, user_id: ctx.user.id,
    action: 'era.disputed',
    resource_type: 'era_remittance', resource_id: id,
    severity: 'warning',
    details: { reason: body?.reason ?? null },
  })
  return NextResponse.json({ ok: true })
}
