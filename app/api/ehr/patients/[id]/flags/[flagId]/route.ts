// W49 D5 — clear a flag.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; flagId: string }> }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id: patientId, flagId } = await params

  const upd = await pool.query(
    `UPDATE patient_flags
        SET cleared_at = NOW(), cleared_by_user_id = $1
      WHERE id = $2 AND patient_id = $3 AND practice_id = $4 AND cleared_at IS NULL
      RETURNING id, type`,
    [ctx.user.id, flagId, patientId, ctx.practiceId],
  )
  if (upd.rows.length === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  await auditEhrAccess({
    ctx, action: 'patient_flag.cleared',
    resourceType: 'patient_flag', resourceId: flagId,
    details: { patient_id: patientId, type: upd.rows[0].type },
  })

  return NextResponse.json({ ok: true })
}
