// app/api/ehr/treatment-plans/[id]/reviews/route.ts
//
// Wave 39 / Task 3 — list + create treatment-plan reviews.
//
// GET  → list reviews for a plan (newest first; cosign + reviewer info joined).
// POST → create a new review. Computes next_review_at = reviewed_at + 90d
//        unless the body overrides; updates the parent plan's next_review_at
//        atomically (transaction).
//
// Cosign required if the reviewing user has supervisor_user_id set
// (mirrors the Wave 38 progress-note cosign-queue pattern).

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const VALID_OUTCOMES = new Set([
  'continue_unchanged', 'continue_with_modifications', 'discharge', 'transfer',
])

function add90Days(d: Date): string {
  const next = new Date(d.getTime() + 90 * 24 * 60 * 60 * 1000)
  return next.toISOString().slice(0, 10)
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id: planId } = await params

  const { rows } = await pool.query(
    `SELECT r.*,
            COALESCE(u.full_name, u.email) AS reviewed_by_name,
            COALESCE(c.full_name, c.email) AS cosigned_by_name
       FROM ehr_treatment_plan_reviews r
       LEFT JOIN users u ON u.id = r.reviewed_by
       LEFT JOIN users c ON c.id = r.cosigned_by
      WHERE r.practice_id = $1 AND r.treatment_plan_id = $2
      ORDER BY r.reviewed_at DESC
      LIMIT 50`,
    [ctx.practiceId, planId],
  )

  await auditEhrAccess({
    ctx,
    action: 'treatment_plan_review.viewed',
    resourceType: 'ehr_treatment_plan',
    resourceId: planId,
    details: { count: rows.length },
  })

  return NextResponse.json({ reviews: rows })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id: planId } = await params

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const outcome = String(body.review_outcome ?? '')
  if (!VALID_OUTCOMES.has(outcome)) {
    return NextResponse.json(
      {
        error: {
          code: 'invalid_request',
          message: `review_outcome must be one of ${[...VALID_OUTCOMES].join(', ')}`,
          retryable: false,
        },
      },
      { status: 400 },
    )
  }

  const progressNotes = String(body.progress_notes ?? '').trim()
  if (!progressNotes) {
    return NextResponse.json(
      {
        error: {
          code: 'invalid_request',
          message: 'progress_notes is required',
          retryable: false,
        },
      },
      { status: 400 },
    )
  }

  const goalStatus = body.goal_status && typeof body.goal_status === 'object'
    ? body.goal_status
    : {}
  const modifications = typeof body.modifications === 'string' ? body.modifications : null

  // next_review_at: caller-supplied YYYY-MM-DD if present, else +90 from now.
  const nextReview =
    typeof body.next_review_at === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.next_review_at)
      ? body.next_review_at
      : add90Days(new Date())

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // Verify plan belongs to the practice and grab patient_id.
    const plan = await client.query(
      `SELECT id, patient_id FROM ehr_treatment_plans
        WHERE practice_id = $1 AND id = $2 LIMIT 1`,
      [ctx.practiceId, planId],
    )
    if (plan.rows.length === 0) {
      await client.query('ROLLBACK')
      return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
    }

    // Cosign required if reviewer has a supervisor on file.
    const sup = await client.query(
      `SELECT supervisor_user_id FROM users WHERE id = $1 LIMIT 1`,
      [ctx.user.id],
    ).catch(() => ({ rows: [] as any[] }))
    const cosignRequired = !!sup.rows[0]?.supervisor_user_id

    const ins = await client.query(
      `INSERT INTO ehr_treatment_plan_reviews
         (treatment_plan_id, patient_id, practice_id, reviewed_by,
          review_outcome, progress_notes, goal_status, modifications,
          next_review_at, cosign_required)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10)
       RETURNING *`,
      [
        planId, plan.rows[0].patient_id, ctx.practiceId, ctx.user.id,
        outcome, progressNotes, JSON.stringify(goalStatus), modifications,
        nextReview, cosignRequired,
      ],
    )

    // Update the parent plan's next_review_at unless the outcome ended
    // services. discharge/transfer => leave the plan; the discharge
    // summary endpoint flips patient.patient_status = 'discharged'.
    if (outcome === 'continue_unchanged' || outcome === 'continue_with_modifications') {
      await client.query(
        `UPDATE ehr_treatment_plans
            SET next_review_at = $1, updated_at = NOW()
          WHERE id = $2`,
        [nextReview, planId],
      )
    } else {
      // For discharge/transfer, mark plan completed so the active-plan
      // unique index frees up.
      await client.query(
        `UPDATE ehr_treatment_plans
            SET status = 'completed', updated_at = NOW()
          WHERE id = $1 AND status = 'active'`,
        [planId],
      )
    }

    await client.query('COMMIT')

    await auditEhrAccess({
      ctx,
      action: 'treatment_plan_review.created',
      resourceType: 'ehr_treatment_plan_review',
      resourceId: ins.rows[0].id,
      details: {
        treatment_plan_id: planId,
        patient_id: plan.rows[0].patient_id,
        review_outcome: outcome,
        next_review_at: nextReview,
        cosign_required: cosignRequired,
      },
    })

    return NextResponse.json({ review: ins.rows[0] }, { status: 201 })
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}
