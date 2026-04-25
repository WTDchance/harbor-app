// Harbor EHR — draft a SOAP progress note from a call_logs transcript via
// Claude Sonnet. The therapist always reviews + signs manually — drafts
// are inserted with status='draft' and a drafted_from_call_id pointer
// back to the source call.
//
// POST body: { call_log_id: string }
// Response (201):
//   { note: <draft row>, summary, flagged_concerns }
// 429:
//   { error: 'rate_limit_exceeded', used, cap }
//
// Rate limit: 100 AI drafts per practice per UTC day (audit_logs-backed).
// Crisis detection in the system prompt is preserved verbatim — the
// drafter surfaces suicidality / abuse / substance-emergency content into
// flagged_concerns and the Assessment.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
import { checkDraftRateLimit } from '@/lib/aws/ehr/draft-rate-limit'
import { draftNoteFromTranscript } from '@/lib/ehr/draft-note'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// On AWS canonical schema, call_logs.transcript is JSONB (array of turns or
// an object). On older Supabase clusters it was TEXT. Normalise both into
// a single string the LLM can read.
function flattenTranscript(raw: unknown): string {
  if (!raw) return ''
  if (typeof raw === 'string') return raw
  if (Array.isArray(raw)) {
    return raw
      .map((turn: any) => {
        if (typeof turn === 'string') return turn
        const role = turn.role || turn.speaker || turn.sender || ''
        const text = turn.text || turn.message || turn.content || ''
        return role ? `${role}: ${text}` : text
      })
      .filter(Boolean)
      .join('\n')
  }
  // Object — best-effort stringify so the model still has something to read.
  try { return JSON.stringify(raw) } catch { return '' }
}

export async function POST(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  let body: any
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const callLogId = body?.call_log_id
  if (!callLogId || typeof callLogId !== 'string') {
    return NextResponse.json({ error: 'call_log_id is required' }, { status: 400 })
  }

  // Per-practice daily cap before we burn an LLM call.
  const limit = await checkDraftRateLimit(ctx.practiceId!)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'rate_limit_exceeded', used: limit.used, cap: limit.cap },
      { status: 429 },
    )
  }

  // Load the call. Practice scope enforced in the WHERE clause.
  const callResult = await pool.query(
    `SELECT id, practice_id, patient_id, transcript, summary,
            call_type, duration_seconds, started_at, crisis_detected
       FROM call_logs
      WHERE id = $1 AND practice_id = $2
      LIMIT 1`,
    [callLogId, ctx.practiceId],
  )
  const call = callResult.rows[0]
  if (!call) {
    return NextResponse.json({ error: 'Call not found for this practice' }, { status: 404 })
  }
  if (!call.patient_id) {
    return NextResponse.json(
      { error: 'This call is not linked to a patient. Link it first.' },
      { status: 400 },
    )
  }

  const transcriptText = flattenTranscript(call.transcript)
  if (!transcriptText || transcriptText.trim().length < 50) {
    return NextResponse.json(
      { error: 'Call has no transcript or the transcript is too short to draft from.' },
      { status: 400 },
    )
  }

  // Patient context for the prompt (defensive — patient may have been deleted).
  const patientResult = await pool.query(
    `SELECT id, first_name, last_name FROM patients
      WHERE id = $1 AND practice_id = $2 LIMIT 1`,
    [call.patient_id, ctx.practiceId],
  )
  const patient = patientResult.rows[0] ?? null

  let draft
  try {
    draft = await draftNoteFromTranscript({
      transcript: transcriptText,
      callMetadata: {
        call_type: call.call_type,
        duration_seconds: call.duration_seconds,
        created_at: call.started_at, // AWS schema column rename
        crisis_detected: call.crisis_detected,
      },
      patientContext: patient
        ? { first_name: patient.first_name, last_name: patient.last_name }
        : undefined,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Draft generation failed'
    return NextResponse.json({ error: msg }, { status: 502 })
  }

  // Always status='draft' — therapist reviews + signs manually.
  const insert = await pool.query(
    `INSERT INTO ehr_progress_notes (
       practice_id, patient_id, title, note_format,
       subjective, objective, assessment, plan,
       cpt_codes, icd10_codes, status, drafted_from_call_id
     ) VALUES (
       $1, $2, $3, 'soap',
       $4, $5, $6, $7,
       $8::text[], $9::text[], 'draft', $10
     ) RETURNING *`,
    [
      ctx.practiceId, call.patient_id, draft.title,
      draft.subjective, draft.objective, draft.assessment, draft.plan,
      draft.suggested_cpt_codes, draft.suggested_icd10_codes,
      call.id,
    ],
  )
  const note = insert.rows[0]

  await auditEhrAccess({
    ctx,
    action: 'note.draft.create.from_call',
    resourceId: note.id,
    details: {
      call_log_id: call.id,
      patient_id: call.patient_id,
      flagged_concerns: draft.flagged_concerns,
      crisis_detected: !!call.crisis_detected,
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
