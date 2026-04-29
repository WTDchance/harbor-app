// app/api/reception/leads/[id]/mark-exported/route.ts
//
// W51 D2 — mark a lead as imported to the practice's external EHR.

import { NextResponse, type NextRequest } from 'next/server'
import { requireReceptionApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { writeAuditLog } from '@/lib/audit'
import { deliverLeadEvent } from '@/lib/lead-webhooks'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireReceptionApiSession()
  if (ctx instanceof NextResponse) return ctx
  if (!ctx.practiceId) return NextResponse.json({ error: 'no_practice' }, { status: 400 })
  const { id } = await params

  const upd = await pool.query(
    `UPDATE reception_leads
        SET status = 'imported_to_ehr', exported_at = NOW()
      WHERE id = $1 AND practice_id = $2
      RETURNING id, status, exported_at`,
    [id, ctx.practiceId],
  )
  if (upd.rows.length === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  await writeAuditLog({
    practice_id: ctx.practiceId, user_id: ctx.user.id,
    action: 'reception_lead.exported',
    resource_type: 'reception_lead', resource_id: id,
  })

  void deliverLeadEvent('lead.exported', { ...upd.rows[0], practice_id: ctx.practiceId } as any)
  return NextResponse.json({ lead: upd.rows[0] })
}
