// W51 D3 — disconnect a calendar integration.

import { NextResponse, type NextRequest } from 'next/server'
import { requireReceptionApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { writeAuditLog } from '@/lib/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireReceptionApiSession()
  if (ctx instanceof NextResponse) return ctx
  if (!ctx.practiceId) return NextResponse.json({ error: 'no_practice' }, { status: 400 })
  const { id } = await params

  const upd = await pool.query(
    `UPDATE practice_calendar_integrations
        SET status = 'revoked',
            refresh_token_encrypted = '',
            access_token_encrypted = NULL
      WHERE id = $1 AND practice_id = $2
      RETURNING id, provider, account_email`,
    [id, ctx.practiceId],
  )
  if (upd.rows.length === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  await writeAuditLog({
    practice_id: ctx.practiceId, user_id: ctx.user.id,
    action: 'calendar_integration.disconnected',
    resource_type: 'practice_calendar_integration', resource_id: id,
    severity: 'info', details: { provider: upd.rows[0].provider, account_email: upd.rows[0].account_email },
  })
  return NextResponse.json({ ok: true })
}
