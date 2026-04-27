// app/api/ehr/treatment-plans/[id]/reviews/[reviewId]/cosign/route.ts
//
// Wave 39 / Task 3 — supervisor cosign of a treatment-plan review.
// Mirrors the Wave 38 note-cosign pattern: the cosigner must be the
// reviewer's supervisor_user_id, OR an admin allowlist email.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; reviewId: string }> },
) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id: planId, reviewId } = await params

  const adminEmails = (process.env.ADMIN_EMAIL || 'chancewonser@gmail.com')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  const isAdmin = adminEmails.includes(ctx.session.email.toLowerCase())

  // Fetch the review + the reviewer's supervisor.
  const { rows } = await pool.query(
    `SELECT r.id, r.cosign_required, r.cosigned_at, r.reviewed_by,
            u.supervisor_user_id
       FROM ehr_treatment_plan_reviews r
       JOIN users u ON u.id = r.reviewed_by
      WHERE r.practice_id      = $1
        AND r.treatment_plan_id = $2
        AND r.id                = $3
      LIMIT 1`,
    [ctx.practiceId, planId, reviewId],
  )
  const r = rows[0]
  if (!r) return NextResponse.json({ error: 'Review not found' }, { status: 404 })

  if (!r.cosign_required) {
    return NextResponse.json(
      {
        error: {
          code: 'cosign_not_required',
          message: 'This review does not require cosign.',
          retryable: false,
        },
      },
      { status: 409 },
    )
  }
  if (r.cosigned_at) {
    return NextResponse.json(
      {
        error: {
          code: 'already_cosigned',
          message: 'This review has already been cosigned.',
          retryable: false,
        },
      },
      { status: 409 },
    )
  }

  // Authorisation: cosigner must be the reviewer's supervisor or admin.
  const isSupervisor = r.supervisor_user_id === ctx.user.id
  if (!isSupervisor && !isAdmin) {
    return NextResponse.json(
      {
        error: {
          code: 'forbidden',
          message: 'Only the reviewer\'s supervisor can cosign this review.',
          retryable: false,
        },
      },
      { status: 403 },
    )
  }

  const upd = await pool.query(
    `UPDATE ehr_treatment_plan_reviews
        SET cosigned_at = NOW(), cosigned_by = $1
      WHERE id = $2
      RETURNING *`,
    [ctx.user.id, reviewId],
  )

  await auditEhrAccess({
    ctx,
    action: 'treatment_plan_review.cosigned',
    resourceType: 'ehr_treatment_plan_review',
    resourceId: reviewId,
    details: {
      treatment_plan_id: planId,
      reviewed_by: r.reviewed_by,
      via: isAdmin && !isSupervisor ? 'admin_override' : 'supervisor',
    },
  })

  return NextResponse.json({ review: upd.rows[0] })
}
