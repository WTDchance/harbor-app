// W49 D3 — delete a specialty chip.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; specialtyId: string }> }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id: therapistId, specialtyId } = await params

  const del = await pool.query(
    `DELETE FROM therapist_specialties
      WHERE id = $1 AND therapist_id = $2 AND practice_id = $3 RETURNING id`,
    [specialtyId, therapistId, ctx.practiceId],
  )
  if (del.rows.length === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  await auditEhrAccess({
    ctx, action: 'credential.specialty.delete',
    resourceType: 'therapist_specialty', resourceId: specialtyId,
  })
  return NextResponse.json({ ok: true })
}
