// app/api/ehr/patients/[id]/flags/[flagId]/route.ts
//
// PATCH — edit content/color. Body { content?, color?, archived?: bool }.
// archived: true sets archived_at = NOW(); archived: false clears it
// (and counts against the 5-active limit on un-archive — caller must
// have headroom).

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_ACTIVE = 5
const COLORS = new Set(['blue', 'green', 'yellow', 'red'])

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; flagId: string } },
) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'invalid_json' }, { status: 400 })

  const fields: string[] = []
  const args: any[] = []
  let archiving = false

  if (body.content !== undefined) {
    const c = String(body.content).trim()
    if (!c || c.length > 200) {
      return NextResponse.json({ error: 'content_invalid' }, { status: 400 })
    }
    args.push(c); fields.push(`content = $${args.length}`)
  }
  if (body.color !== undefined) {
    if (!COLORS.has(body.color)) return NextResponse.json({ error: 'color_invalid' }, { status: 400 })
    args.push(body.color); fields.push(`color = $${args.length}`)
  }
  if (body.archived === true) {
    fields.push(`archived_at = NOW()`)
    archiving = true
  } else if (body.archived === false) {
    // Re-activating: ensure headroom (≤ MAX_ACTIVE - 1 currently active).
    const cnt = await pool.query(
      `SELECT COUNT(*)::int AS n FROM ehr_patient_flags
        WHERE practice_id = $1 AND patient_id = $2 AND archived_at IS NULL AND id <> $3`,
      [ctx.practiceId, params.id, params.flagId],
    )
    if (cnt.rows[0].n >= MAX_ACTIVE) {
      return NextResponse.json({ error: 'flag_limit_reached', max: MAX_ACTIVE }, { status: 409 })
    }
    fields.push(`archived_at = NULL`)
  }

  if (fields.length === 0) return NextResponse.json({ error: 'no_fields' }, { status: 400 })

  args.push(params.flagId, ctx.practiceId, params.id)
  const { rows } = await pool.query(
    `UPDATE ehr_patient_flags SET ${fields.join(', ')}
      WHERE id = $${args.length - 2}
        AND practice_id = $${args.length - 1}
        AND patient_id = $${args.length}
      RETURNING id, content, color, created_at, updated_at, archived_at`,
    args,
  )
  if (rows.length === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  await auditEhrAccess({
    ctx,
    action: archiving ? 'patient_flag.archived' : 'patient_flag.updated',
    resourceType: 'ehr_patient_flag',
    resourceId: params.flagId,
    details: { fields_changed: fields.length },
  })

  return NextResponse.json({ flag: rows[0] })
}
