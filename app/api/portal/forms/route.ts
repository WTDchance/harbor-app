// app/api/portal/forms/route.ts
//
// W47 T2 — patient sees forms sent to them. Active forms only;
// patient sees the questions and either has a prior response or
// not.

import { NextResponse } from 'next/server'
import { requirePortalSession } from '@/lib/aws/portal-auth'
import { pool } from '@/lib/aws/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const sess = await requirePortalSession()
  if (sess instanceof NextResponse) return sess

  // Show active practice forms. The therapist may have explicitly
  // sent one to this patient (via custom_form.sent audit) or made
  // it available globally — for v1 we surface all active forms and
  // mark which the patient has already responded to.
  const { rows } = await pool.query(
    `SELECT f.id, f.name, f.description, f.kind, f.questions,
            (SELECT COUNT(*)::int FROM ehr_custom_form_responses r
              WHERE r.form_id = f.id AND r.patient_id = $1) AS prior_responses
       FROM ehr_custom_forms f
      WHERE f.practice_id = $2 AND f.is_active = TRUE
      ORDER BY f.name ASC`,
    [sess.patientId, sess.practiceId],
  )
  return NextResponse.json({ forms: rows })
}
