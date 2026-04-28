// app/api/ehr/custom-forms/[id]/send/route.ts
//
// W47 T2 — record a 'send' event for a form to a patient. Audit
// only; actual SMS/email delivery is a follow-up. The patient sees
// the form on their portal under /portal/forms.
//
// Body: { patient_ids: string[] }

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const body = await req.json().catch(() => null)
  const ids: string[] = Array.isArray(body?.patient_ids) ? body.patient_ids.map(String) : []
  if (ids.length === 0) return NextResponse.json({ error: 'patient_ids[] required' }, { status: 400 })

  // Validate the form belongs to this practice and is active.
  const f = await pool.query(
    `SELECT id, is_active, name FROM ehr_custom_forms
      WHERE id = $1 AND practice_id = $2 LIMIT 1`,
    [params.id, ctx.practiceId],
  )
  if (f.rows.length === 0) return NextResponse.json({ error: 'form_not_found' }, { status: 404 })
  if (!f.rows[0].is_active) return NextResponse.json({ error: 'form_inactive' }, { status: 400 })

  // Validate patients are in this practice.
  const valid = await pool.query(
    `SELECT id::text FROM patients WHERE id = ANY($1::uuid[]) AND practice_id = $2`,
    [ids, ctx.practiceId],
  )
  const validSet = new Set(valid.rows.map((r: any) => r.id))
  const targets = ids.filter((x) => validSet.has(x))

  for (const pid of targets) {
    await auditEhrAccess({
      ctx, action: 'custom_form.sent',
      resourceType: 'ehr_custom_form', resourceId: params.id,
      details: { patient_id: pid, channel: 'portal' },
    })
  }

  return NextResponse.json({
    ok: true, sent: targets.length, skipped: ids.length - targets.length,
  })
}
