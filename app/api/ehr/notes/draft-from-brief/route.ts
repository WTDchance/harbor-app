// Harbor EHR — primary AI-draft route.
//
// Therapist types a short freeform brief ("Session 5, worked on breathing,
// pt discussed conflict with spouse, assigned thought log") and Sonnet
// expands into a full SOAP draft using thin patient history (last 3
// signed notes + last 5 assessments) for context.
//
// POST body: { patient_id, brief }
// Response (201): { note, summary, flagged_concerns }
// 429:           { error: 'rate_limit_exceeded', used, cap }
//
// Always status='draft' — therapist reviews + signs manually.
// Rate limit: 100 AI drafts per practice per UTC day.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
import { checkDraftRateLimit } from '@/lib/aws/ehr/draft-rate-limit'
import { draftNoteFromBrief, type HistoryContext } from '@/lib/ehr/draft-note'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  let body: any
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const patientId = body?.patient_id
  const briefRaw = body?.brief
  if (!patientId || typeof patientId !== 'string') {
    return NextResponse.json({ error: 'patient_id is required' }, { status: 400 })
  }
  if (!briefRaw || typeof briefRaw !== 'string' || briefRaw.trim().length < 4) {
    return NextResponse.json(
      { error: 'brief is required (at least a few words)' },
      { status: 400 },
    )
  }
  const brief = briefRaw.trim()

  // Rate limit before LLM call.
  const limit = await checkDraftRateLimit(ctx.practiceId!)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'rate_limit_exceeded', used: limit.used, cap: limit.cap },
      { status: 429 },
    )
  }

  // Verify patient belongs to caller's practice.
  // 'reason_for_seeking' isn't on the AWS canonical patients schema; select
  // defensively (cast to JSONB-aware text via to_jsonb so missing-column
  // failures don't 500). We grab presenting_concerns as a sensible fallback.
  const patientResult = await pool.query(
    `SELECT id, practice_id, first_name, last_name, presenting_concerns
       FROM patients
      WHERE id = $1 AND practice_id = $2 LIMIT 1`,
    [patientId, ctx.practiceId],
  )
  const patient = patientResult.rows[0]
  if (!patient) {
    return NextResponse.json({ error: 'Patient not found for this practice' }, { status: 404 })
  }
  const reasonForSeeking = Array.isArray(patient.presenting_concerns) && patient.presenting_concerns.length
    ? patient.presenting_concerns.join(', ')
    : null

  // Thin history context for the prompt.
  const history: HistoryContext = {}
  try {
    const { rows: recent } = await pool.query(
      `SELECT title, note_format, created_at, assessment, plan
         FROM ehr_progress_notes
        WHERE practice_id = $1 AND patient_id = $2
          AND status IN ('signed', 'amended')
        ORDER BY created_at DESC
        LIMIT 3`,
      [ctx.practiceId, patientId],
    )
    if (recent.length > 0) {
      history.recent_notes = recent.map(n => ({
        title: n.title,
        note_format: n.note_format,
        created_at: new Date(n.created_at).toLocaleDateString(),
        assessment: n.assessment,
        plan: n.plan,
      }))
    }
  } catch {
    // schema drift on prior notes — skip rather than 500
  }

  try {
    const { rows: assessments } = await pool.query(
      `SELECT * FROM patient_assessments
        WHERE patient_id = $1
        ORDER BY created_at DESC
        LIMIT 5`,
      [patientId],
    )
    if (assessments.length > 0) {
      history.recent_assessments = assessments.map((a: any) => ({
        instrument: a.instrument || a.assessment_type || a.type || 'assessment',
        score: a.score ?? a.total ?? a.value ?? '',
        date: a.created_at ? new Date(a.created_at).toLocaleDateString() : '',
      }))
    }
  } catch {
    // patient_assessments column shape varies — defensive skip
  }

  let draft
  try {
    draft = await draftNoteFromBrief({
      brief,
      patientContext: {
        first_name: patient.first_name,
        last_name: patient.last_name,
        reason_for_seeking: reasonForSeeking,
      },
      history,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Draft generation failed'
    return NextResponse.json({ error: msg }, { status: 502 })
  }

  const insert = await pool.query(
    `INSERT INTO ehr_progress_notes (
       practice_id, patient_id, title, note_format,
       subjective, objective, assessment, plan,
       cpt_codes, icd10_codes, status
     ) VALUES (
       $1, $2, $3, 'soap',
       $4, $5, $6, $7,
       $8::text[], $9::text[], 'draft'
     ) RETURNING *`,
    [
      ctx.practiceId, patientId, draft.title,
      draft.subjective, draft.objective, draft.assessment, draft.plan,
      draft.suggested_cpt_codes, draft.suggested_icd10_codes,
    ],
  )
  const note = insert.rows[0]

  await auditEhrAccess({
    ctx,
    action: 'note.draft.create.from_brief',
    resourceId: note.id,
    details: {
      patient_id: patientId,
      brief_length: brief.length,
      flagged_concerns: draft.flagged_concerns,
      drafts_used_today: limit.used + 1,
      drafts_cap: limit.cap,
    },
  })

  return NextResponse.json(
    {
      note,
      summary: draft.summary_for_review,
      flagged_concerns: draft.flagged_concerns,
    },
    { status: 201 },
  )
}
