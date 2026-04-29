// app/api/ehr/admin/credentialing-overview/route.ts
//
// W49 T4 — admin view of all practice users' credentials. Highlights
// rows expiring in <=30 days as 'expiring_soon' for the UI.

import { NextResponse } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function isAdminEmail(email: string | undefined | null): boolean {
  if (!email) return false
  const allow = (process.env.ADMIN_EMAIL || 'chancewonser@gmail.com')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  return allow.includes(email.toLowerCase())
}

export async function GET() {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  if (!isAdminEmail(ctx.session?.email) && ctx.user?.role !== 'owner' && ctx.user?.role !== 'supervisor') {
    return NextResponse.json({ error: 'admin_only' }, { status: 403 })
  }

  const year = new Date().getUTCFullYear()
  const { rows } = await pool.query(
    `SELECT u.id::text, u.email, u.full_name, u.role,
            u.npi, u.license_type, u.license_number, u.license_state,
            u.license_expires_at::text, u.caqh_id, u.dea_number,
            CASE
              WHEN u.license_expires_at IS NULL THEN 'unknown'
              WHEN u.license_expires_at < NOW() THEN 'expired'
              WHEN u.license_expires_at <= NOW() + INTERVAL '30 days' THEN 'expiring_soon'
              ELSE 'ok'
            END AS license_status,
            COALESCE((
              SELECT SUM(hours)::float FROM ehr_continuing_education ce
               WHERE ce.user_id = u.id AND ce.audit_year = $2
            ), 0) AS ce_hours_this_year
       FROM users u
      WHERE u.practice_id = $1
      ORDER BY
        CASE
          WHEN u.license_expires_at IS NULL THEN 2
          WHEN u.license_expires_at < NOW() THEN 0
          WHEN u.license_expires_at <= NOW() + INTERVAL '30 days' THEN 1
          ELSE 3
        END,
        u.license_expires_at NULLS LAST,
        u.full_name`,
    [ctx.practiceId, year],
  )

  await auditEhrAccess({
    ctx,
    action: 'credentialing.updated',  // listing the overview is benign; reuse the family
    resourceType: 'practice',
    details: { kind: 'overview_viewed', user_count: rows.length },
  })

  return NextResponse.json({ year, users: rows })
}
