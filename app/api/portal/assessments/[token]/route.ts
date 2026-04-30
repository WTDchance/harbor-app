// W52 D2 — patient-facing GET for an assessment portal token.
import { NextResponse, type NextRequest } from 'next/server'
import { pool } from '@/lib/aws/db'
import { writeAuditLog } from '@/lib/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!token || !token.startsWith('asm_')) return NextResponse.json({ error: 'invalid_token' }, { status: 400 })

  const { rows } = await pool.query(
    `SELECT a.id, a.practice_id, a.assessment_slug, a.status, a.expires_at, a.completed_at,
            d.name, d.short_description, d.questions, d.scoring_rules,
            COALESCE(p.first_name, l.first_name) AS first_name,
            COALESCE(p.last_name, l.last_name) AS last_name,
            pr.name AS practice_name
       FROM assessment_administrations a
       JOIN assessment_definitions d ON d.slug = a.assessment_slug
       LEFT JOIN patients p ON p.id = a.patient_id
       LEFT JOIN reception_leads l ON l.id = a.lead_id
       JOIN practices pr ON pr.id = a.practice_id
      WHERE a.portal_token = $1 LIMIT 1`,
    [token],
  )
  if (rows.length === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const row = rows[0]
  if (new Date(row.expires_at) < new Date() && row.status !== 'completed') {
    await pool.query(`UPDATE assessment_administrations SET status = 'expired' WHERE id = $1 AND status NOT IN ('completed')`, [row.id]).catch(() => null)
    return NextResponse.json({ error: 'expired' }, { status: 410 })
  }
  if (row.status === 'pending') {
    await pool.query(`UPDATE assessment_administrations SET status = 'in_progress', started_at = NOW() WHERE id = $1`, [row.id]).catch(() => null)
  }

  return NextResponse.json({
    administration: { id: row.id, status: row.status, completed_at: row.completed_at },
    definition: { slug: row.assessment_slug, name: row.name, short_description: row.short_description, questions: row.questions, scoring_rules: row.scoring_rules },
    signer: { first_name: row.first_name, last_name: row.last_name },
    practice: { name: row.practice_name },
  })
}
