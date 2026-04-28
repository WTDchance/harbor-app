// app/api/portal/forms/[id]/submit/route.ts
//
// W47 T2 — patient submits a form response. Body: { responses }.
// Each key in responses maps to the question id; values are typed
// to match the question type (number for likert/numeric, string
// for free_text, etc.). We don't validate beyond JSON.parse — the
// therapist sees raw responses on their side.

import { NextResponse, type NextRequest } from 'next/server'
import { requirePortalSession } from '@/lib/aws/portal-auth'
import { auditPortalAccess } from '@/lib/aws/ehr/audit'
import { pool } from '@/lib/aws/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const sess = await requirePortalSession()
  if (sess instanceof NextResponse) return sess

  const body = await req.json().catch(() => null)
  if (!body || typeof body.responses !== 'object') {
    return NextResponse.json({ error: 'responses object required' }, { status: 400 })
  }

  // Verify form is in this practice + active.
  const f = await pool.query(
    `SELECT id FROM ehr_custom_forms
      WHERE id = $1 AND practice_id = $2 AND is_active = TRUE LIMIT 1`,
    [params.id, sess.practiceId],
  )
  if (f.rows.length === 0) return NextResponse.json({ error: 'form_not_found' }, { status: 404 })

  const ins = await pool.query(
    `INSERT INTO ehr_custom_form_responses
       (practice_id, form_id, patient_id, responses, submitted_by)
     VALUES ($1, $2, $3, $4::jsonb, 'patient')
     RETURNING id, submitted_at`,
    [sess.practiceId, params.id, sess.patientId, JSON.stringify(body.responses)],
  )

  await auditPortalAccess({
    session: sess,
    action: 'portal.custom_form.submitted',
    resourceType: 'ehr_custom_form_response',
    resourceId: ins.rows[0].id,
    details: {
      form_id: params.id,
      response_count: Object.keys(body.responses).length,
    },
  })

  return NextResponse.json({ response_id: ins.rows[0].id, submitted_at: ins.rows[0].submitted_at })
}
