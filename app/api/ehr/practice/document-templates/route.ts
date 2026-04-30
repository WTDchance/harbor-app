// W52 D1 — list + create document templates.
import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
import { ESIGN_CATEGORIES, type EsignCategory } from '@/lib/ehr/esign'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { rows } = await pool.query(
    `SELECT id, name, category, body_html, variables, signature_fields, status, created_at, updated_at
       FROM practice_document_templates
      WHERE practice_id = $1 AND status = 'active'
      ORDER BY category, name`,
    [ctx.practiceId],
  )
  await auditEhrAccess({ ctx, action: 'document_template.list' as any, resourceType: 'practice_document_template', details: { count: rows.length } })
  return NextResponse.json({ templates: rows })
}

export async function POST(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  const name = String(body.name ?? '').trim().slice(0, 200)
  if (!name) return NextResponse.json({ error: 'name_required' }, { status: 400 })
  if (!ESIGN_CATEGORIES.includes(body.category as EsignCategory)) {
    return NextResponse.json({ error: 'invalid_category' }, { status: 400 })
  }
  const ins = await pool.query(
    `INSERT INTO practice_document_templates
       (practice_id, name, category, body_html, variables, signature_fields)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)
     RETURNING id, name, category, body_html, variables, signature_fields, status, created_at, updated_at`,
    [ctx.practiceId, name, body.category, String(body.body_html ?? ''),
     JSON.stringify(body.variables ?? []), JSON.stringify(body.signature_fields ?? [])],
  )
  await auditEhrAccess({ ctx, action: 'document_template.created' as any, resourceType: 'practice_document_template', resourceId: ins.rows[0].id, details: { name, category: body.category } })
  return NextResponse.json({ template: ins.rows[0] }, { status: 201 })
}
