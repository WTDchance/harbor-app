// app/api/ehr/letter-templates/route.ts
//
// Wave 42 / T3 — practice-scoped letter template list + create.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const KINDS = new Set(['disability','school_accommodation','court'])

export async function GET(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const kind = req.nextUrl.searchParams.get('kind')
  const conds = ['practice_id = $1', 'is_archived = FALSE']
  const args: unknown[] = [ctx.practiceId]
  if (kind && KINDS.has(kind)) { args.push(kind); conds.push(`kind = $${args.length}`) }

  const { rows } = await pool.query(
    `SELECT * FROM ehr_letter_templates
      WHERE ${conds.join(' AND ')}
      ORDER BY kind ASC, is_default DESC, name ASC`,
    args,
  )
  return NextResponse.json({ templates: rows })
}

export async function POST(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const kind = String(body.kind ?? '')
  const name = String(body.name ?? '').trim()
  const tmpl = String(body.body_md_template ?? '').trim()
  if (!KINDS.has(kind) || !name || !tmpl) {
    return NextResponse.json(
      { error: { code: 'invalid_request', message: `kind (${[...KINDS].join('|')}), name, body_md_template required` } },
      { status: 400 },
    )
  }
  const isDefault = body.is_default === true

  if (isDefault) {
    // Clear any existing default for this kind to satisfy the partial unique index.
    await pool.query(
      `UPDATE ehr_letter_templates SET is_default = FALSE
        WHERE practice_id = $1 AND kind = $2 AND is_default = TRUE`,
      [ctx.practiceId, kind],
    )
  }

  const { rows } = await pool.query(
    `INSERT INTO ehr_letter_templates
       (practice_id, kind, name, body_md_template, is_default, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [ctx.practiceId, kind, name, tmpl, isDefault, ctx.user.id],
  )

  await auditEhrAccess({
    ctx,
    action: 'letter.template_create',
    resourceType: 'ehr_letter_template',
    resourceId: rows[0].id,
    details: { kind, is_default: isDefault, body_length: tmpl.length },
  })

  return NextResponse.json({ template: rows[0] }, { status: 201 })
}
