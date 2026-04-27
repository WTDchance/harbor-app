// app/api/ehr/letter-templates/[id]/route.ts
//
// Wave 42 / T3 — update or archive one letter template. No DELETE —
// archive instead, so historical letters that referenced this
// template still resolve their template_id.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id } = await params

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const sets: string[] = []
  const args: unknown[] = []
  if (typeof body.name === 'string') { args.push(body.name); sets.push(`name = $${args.length}`) }
  if (typeof body.body_md_template === 'string') {
    args.push(body.body_md_template); sets.push(`body_md_template = $${args.length}`)
  }
  if (typeof body.is_default === 'boolean') {
    if (body.is_default) {
      // Clear existing default for this kind.
      await pool.query(
        `UPDATE ehr_letter_templates SET is_default = FALSE
          WHERE practice_id = $1
            AND kind = (SELECT kind FROM ehr_letter_templates WHERE id = $2)
            AND id <> $2`,
        [ctx.practiceId, id],
      )
    }
    args.push(body.is_default); sets.push(`is_default = $${args.length}`)
  }
  if (typeof body.is_archived === 'boolean') {
    args.push(body.is_archived); sets.push(`is_archived = $${args.length}`)
    if (body.is_archived) {
      // Archived templates can't be default.
      args.push(false); sets.push(`is_default = $${args.length}`)
    }
  }
  if (sets.length === 0) return NextResponse.json({ error: 'no fields to update' }, { status: 400 })

  args.push(ctx.practiceId, id)
  const { rows } = await pool.query(
    `UPDATE ehr_letter_templates SET ${sets.join(', ')}
      WHERE practice_id = $${args.length - 1} AND id = $${args.length}
      RETURNING *`,
    args,
  )
  if (!rows[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await auditEhrAccess({
    ctx,
    action: 'letter.template_update',
    resourceType: 'ehr_letter_template',
    resourceId: id,
    details: { fields_changed: sets.map((s) => s.split(' ')[0]) },
  })

  return NextResponse.json({ template: rows[0] })
}
