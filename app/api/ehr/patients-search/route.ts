// app/api/ehr/patients-search/route.ts
//
// W49 D5 — apply a saved view's filter (or an inline filter) and return
// the matching patient rows. Used by the /dashboard/patients page when
// a Saved View is selected.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
import { buildFilterSql, type FilterNode } from '@/lib/ehr/patient-flags'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SORTABLE: Record<string, string> = {
  first_name:        'p.first_name',
  last_name:         'p.last_name',
  created_at:        'p.created_at',
  last_contact_at:   'p.last_contact_at',
  first_contact_at:  'p.first_contact_at',
  patient_status:    'p.patient_status',
  risk_level:        'p.risk_level',
}

export async function POST(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const body = await req.json().catch(() => null) as {
    filter?: FilterNode
    sort?: { field?: string; direction?: 'asc' | 'desc' }
    limit?: number
    offset?: number
  } | null
  if (!body) return NextResponse.json({ error: 'invalid_json' }, { status: 400 })

  const built = buildFilterSql(body.filter ?? null, [ctx.practiceId])
  const params = built.params
  const where = `p.practice_id = $1 AND ${built.whereSql}`

  const flagJoin = built.joinFlags ? `
    LEFT JOIN LATERAL (
      SELECT array_agg(DISTINCT type) AS types
        FROM patient_flags pf2
       WHERE pf2.practice_id = p.practice_id
         AND pf2.patient_id = p.id
         AND pf2.cleared_at IS NULL
    ) pf ON TRUE` : ''

  const sortField = body.sort?.field && SORTABLE[body.sort.field] ? SORTABLE[body.sort.field] : 'p.last_name'
  const sortDir = body.sort?.direction === 'desc' ? 'DESC' : 'ASC'
  const limit = Math.max(1, Math.min(500, Number(body.limit) || 100))
  const offset = Math.max(0, Number(body.offset) || 0)

  const sql = `
    SELECT p.id, p.first_name, p.last_name, p.email, p.phone, p.patient_status AS status,
           p.created_at, p.last_contact_at, p.risk_level,
           COALESCE(
             (SELECT array_agg(DISTINCT type)
                FROM patient_flags pf3
               WHERE pf3.practice_id = p.practice_id
                 AND pf3.patient_id = p.id
                 AND pf3.cleared_at IS NULL),
             '{}'::text[]
           ) AS active_flags
      FROM patients p
      ${flagJoin}
      WHERE ${where}
      ORDER BY ${sortField} ${sortDir} NULLS LAST, p.last_name ASC
      LIMIT ${limit} OFFSET ${offset}`

  const { rows } = await pool.query(sql, params)

  await auditEhrAccess({
    ctx, action: 'saved_view.viewed',
    resourceType: 'patients_search',
    details: { count: rows.length, sort: sortField, has_flag_filter: built.joinFlags },
  })

  return NextResponse.json({ patients: rows })
}
