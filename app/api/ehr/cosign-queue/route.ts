// app/api/ehr/cosign-queue/route.ts
//
// Wave 38 / TS9 — supervisor cosign queue.
//
// Lists all signed notes whose author has the calling user configured
// as their supervisor. Admin emails see ALL pending cosigns in the
// practice (consistent with the cosign route's admin override).

import { NextResponse } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const adminEmails = (process.env.ADMIN_EMAIL || 'chancewonser@gmail.com')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  const isAdmin = adminEmails.includes(ctx.session.email.toLowerCase())

  // Supervisor scope: notes whose signed_by user has supervisor_user_id = me.
  // Admin scope: all pending cosigns in the practice.
  let sql: string
  let args: unknown[]
  if (isAdmin) {
    sql = `
      SELECT n.id, n.title, n.created_at, n.signed_at, n.patient_id,
             n.signed_by, COALESCE(u.full_name, u.email) AS signed_by_name,
             p.first_name AS patient_first, p.last_name AS patient_last
        FROM ehr_progress_notes n
        LEFT JOIN users    u ON u.id = n.signed_by
        LEFT JOIN patients p ON p.id = n.patient_id
       WHERE n.practice_id = $1
         AND n.cosign_status = 'pending'
       ORDER BY n.signed_at ASC NULLS LAST, n.created_at ASC
       LIMIT 200
    `
    args = [ctx.practiceId]
  } else {
    sql = `
      SELECT n.id, n.title, n.created_at, n.signed_at, n.patient_id,
             n.signed_by, COALESCE(u.full_name, u.email) AS signed_by_name,
             p.first_name AS patient_first, p.last_name AS patient_last
        FROM ehr_progress_notes n
        JOIN users u ON u.id = n.signed_by
        LEFT JOIN patients p ON p.id = n.patient_id
       WHERE n.practice_id = $1
         AND n.cosign_status = 'pending'
         AND u.supervisor_user_id = $2
       ORDER BY n.signed_at ASC NULLS LAST, n.created_at ASC
       LIMIT 200
    `
    args = [ctx.practiceId, ctx.user.id]
  }

  const { rows } = await pool.query(sql, args).catch(() => ({ rows: [] as any[] }))

  // Wave 39 — also surface pending treatment-plan-review cosigns.
  // Same auth scope as notes (admin sees the practice; supervisors see
  // their own reviewees). Tolerant of the table not yet existing on
  // this RDS — empty array fallback so the notes side keeps rendering.
  let reviewSql: string
  let reviewArgs: unknown[]
  if (isAdmin) {
    reviewSql = `
      SELECT r.id, r.treatment_plan_id, r.patient_id,
             r.reviewed_at, r.review_outcome, r.reviewed_by,
             COALESCE(u.full_name, u.email) AS reviewed_by_name,
             p.first_name AS patient_first, p.last_name AS patient_last
        FROM ehr_treatment_plan_reviews r
        LEFT JOIN users    u ON u.id = r.reviewed_by
        LEFT JOIN patients p ON p.id = r.patient_id
       WHERE r.practice_id    = $1
         AND r.cosign_required = TRUE
         AND r.cosigned_at     IS NULL
       ORDER BY r.reviewed_at ASC
       LIMIT 200
    `
    reviewArgs = [ctx.practiceId]
  } else {
    reviewSql = `
      SELECT r.id, r.treatment_plan_id, r.patient_id,
             r.reviewed_at, r.review_outcome, r.reviewed_by,
             COALESCE(u.full_name, u.email) AS reviewed_by_name,
             p.first_name AS patient_first, p.last_name AS patient_last
        FROM ehr_treatment_plan_reviews r
        JOIN users u ON u.id = r.reviewed_by
        LEFT JOIN patients p ON p.id = r.patient_id
       WHERE r.practice_id      = $1
         AND r.cosign_required   = TRUE
         AND r.cosigned_at       IS NULL
         AND u.supervisor_user_id = $2
       ORDER BY r.reviewed_at ASC
       LIMIT 200
    `
    reviewArgs = [ctx.practiceId, ctx.user.id]
  }
  const { rows: reviewRows } = await pool.query(reviewSql, reviewArgs)
    .catch(() => ({ rows: [] as any[] }))

  await auditEhrAccess({
    ctx,
    action: 'note.list',
    resourceType: 'cosign_queue',
    details: {
      notes: rows.length,
      treatment_plan_reviews: reviewRows.length,
      scope: isAdmin ? 'admin_practice_wide' : 'supervisor_only',
    },
  })

  return NextResponse.json({
    notes: rows,
    treatment_plan_reviews: reviewRows,
    scope: isAdmin ? 'admin' : 'supervisor',
  })
}
