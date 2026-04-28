// app/api/ehr/note-templates/route.ts
//
// W44 T5 — list + create custom note templates per practice.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Section = { key: string; label: string; helper?: string }

function sanitizeSections(raw: unknown): Section[] {
  if (!Array.isArray(raw)) return []
  const out: Section[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const labelRaw = typeof o.label === 'string' ? o.label.trim() : ''
    if (!labelRaw) continue
    const label = labelRaw.slice(0, 80)
    const helperRaw = typeof o.helper === 'string' ? o.helper.trim() : ''
    const helper = helperRaw.slice(0, 200) || undefined
    let key = typeof o.key === 'string' ? o.key.trim() : ''
    if (!key) {
      key = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 32) || `s${out.length + 1}`
    }
    // Deduplicate keys.
    let unique = key
    let suffix = 2
    while (seen.has(unique)) unique = `${key}_${suffix++}`
    seen.add(unique)
    out.push({ key: unique, label, helper })
  }
  return out
}

export async function GET(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const showArchived = req.nextUrl.searchParams.get('archived') === 'true'

  const where = showArchived
    ? `practice_id = $1`
    : `practice_id = $1 AND archived_at IS NULL`

  const { rows } = await pool.query(
    `SELECT id, name, description, sections, archived_at, created_at, updated_at
       FROM ehr_note_templates
      WHERE ${where}
      ORDER BY archived_at NULLS FIRST, name ASC`,
    [ctx.practiceId],
  )

  return NextResponse.json({ templates: rows })
}

export async function POST(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'invalid_json' }, { status: 400 })

  const name = String(body.name || '').trim()
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 })
  const description = body.description ? String(body.description).slice(0, 500) : null

  const sections = sanitizeSections(body.sections)
  if (sections.length === 0) {
    return NextResponse.json({ error: 'at_least_one_section_required' }, { status: 400 })
  }

  const ins = await pool.query(
    `INSERT INTO ehr_note_templates
       (practice_id, name, description, sections, created_by)
     VALUES ($1, $2, $3, $4::jsonb, $5)
     RETURNING id, name, description, sections, archived_at, created_at, updated_at`,
    [ctx.practiceId, name, description, JSON.stringify(sections), ctx.userId],
  )

  await auditEhrAccess({
    ctx,
    action: 'note_template.created',
    resourceType: 'ehr_note_template',
    resourceId: ins.rows[0].id,
    details: { section_count: sections.length },
  })

  return NextResponse.json({ template: ins.rows[0] }, { status: 201 })
}
