// W49 D6 — combined "needs attention" today widget.

import { NextResponse } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const [unsignedNotes, openTasks, crisisFlags] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS n FROM ehr_progress_notes
                 WHERE practice_id = $1 AND signed_at IS NULL`,
                [ctx.practiceId]).catch(() => ({ rows: [{ n: 0 }] })),
    pool.query(`SELECT COUNT(*)::int AS n FROM ehr_clinical_tasks
                 WHERE practice_id = $1 AND assigned_to_user_id = $2
                   AND completed_at IS NULL
                   AND (due_at IS NULL OR due_at <= NOW() + INTERVAL '24 hours')`,
                [ctx.practiceId, ctx.user.id]).catch(() => ({ rows: [{ n: 0 }] })),
    pool.query(`SELECT COUNT(*)::int AS n FROM patient_flags
                 WHERE practice_id = $1 AND type = 'suicide_risk' AND cleared_at IS NULL`,
                [ctx.practiceId]).catch(() => ({ rows: [{ n: 0 }] })),
  ])

  return NextResponse.json({
    unsigned_notes: unsignedNotes.rows[0].n,
    tasks_due_today: openTasks.rows[0].n,
    active_crisis_flags: crisisFlags.rows[0].n,
  })
}
