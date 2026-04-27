// app/api/ehr/patients/[id]/suggested-diagnoses/route.ts
//
// Wave 31b — Sonnet-suggested ICD-10 codes for a patient. Reads the
// intake form, recent assessments, presenting concerns, and recent
// progress notes, then returns the top 3 most-clinically-likely
// ICD-10 codes with brief rationales.
//
// The picker UI shows these at the top of the diagnosis dropdown so
// the therapist starts from "here are the 3 most likely options" rather
// than scrolling through every ICD-10 code Valiant-style.
//
// GET — returns cached suggestions (last 24h) or generates fresh
// POST — force regeneration

import { createMessage } from '@/lib/aws/llm'
import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/aws/db'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
import { checkAiRateLimit } from '@/lib/aws/ehr/draft-rate-limit'
import { ICD10_CODES, type Code } from '@/lib/ehr/codes'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SYSTEM_PROMPT = `You are a board-certified clinician helping another therapist narrow down likely working diagnoses for a patient. Read the source data, then return the THREE most clinically-supported ICD-10 codes from the provided whitelist, ranked by likelihood.

You MUST only choose codes from the whitelist — do not invent ICD-10 codes. If fewer than 3 codes are well-supported by the data, return fewer; never pad with weak suggestions.

For each suggestion, write ONE short rationale sentence (≤ 20 words) referencing the specific data points that point to it (e.g. "PHQ-9 score of 16 with 4 weeks of low mood and anhedonia").

Return ONLY a JSON object of the form:
{"suggestions": [{"code": "F33.1", "rationale": "..."}, ...]}

No prose, no markdown, no preamble. Pure JSON.`

async function loadPatientContext(practiceId: string, patientId: string): Promise<string> {
  const { rows: pr } = await pool.query(
    `SELECT first_name, last_name, date_of_birth, presenting_concerns,
            referral_source, reason_for_seeking
       FROM patients WHERE id = $1 AND practice_id = $2 LIMIT 1`,
    [patientId, practiceId],
  )
  const p = pr[0] || {}

  const { rows: ir } = await pool.query(
    `SELECT phq9_score, phq9_severity, gad7_score, gad7_severity,
            presenting_concerns, medications, medical_history,
            substance_use, family_history, completed_at
       FROM intake_forms
      WHERE practice_id = $1 AND patient_id = $2
      ORDER BY completed_at DESC NULLS LAST LIMIT 1`,
    [practiceId, patientId],
  )
  const intake = ir[0] || {}

  const { rows: ar } = await pool.query(
    `SELECT assessment_type, score, severity, completed_at
       FROM patient_assessments
      WHERE patient_id = $1
      ORDER BY completed_at DESC NULLS LAST LIMIT 5`,
    [patientId],
  )

  const { rows: nr } = await pool.query(
    `SELECT subjective, assessment, plan, signed_at
       FROM ehr_progress_notes
      WHERE patient_id = $1 AND status IN ('signed', 'amended')
      ORDER BY signed_at DESC NULLS LAST LIMIT 3`,
    [patientId],
  )

  const fmt = JSON.stringify({
    patient: {
      name: [p.first_name, p.last_name].filter(Boolean).join(' '),
      dob: p.date_of_birth,
      presenting_concerns: p.presenting_concerns,
      referral_source: p.referral_source,
      reason_for_seeking: p.reason_for_seeking,
    },
    latest_intake: intake,
    recent_assessments: ar,
    recent_signed_notes: nr,
  }, null, 2)

  // Whitelist: just code + label, keep prompt small
  const whitelist = ICD10_CODES.map((c: Code) => ({ code: c.code, label: c.label }))

  return `PATIENT DATA:
${fmt}

ICD-10 WHITELIST (you MUST only return codes from this list):
${JSON.stringify(whitelist)}`
}

async function loadCached(patientId: string): Promise<{ suggestions: Array<{ code: string; rationale: string }>; generated_at: string } | null> {
  try {
    const { rows } = await pool.query(
      `SELECT details, timestamp
         FROM audit_logs
        WHERE action = 'ai.suggested_diagnoses.cache'
          AND resource_id = $1
          AND timestamp > NOW() - INTERVAL '24 hours'
        ORDER BY timestamp DESC LIMIT 1`,
      [patientId],
    )
    const r = rows[0]
    if (!r) return null
    return {
      suggestions: (r.details?.suggestions || []) as any,
      generated_at: r.timestamp.toISOString(),
    }
  } catch {
    return null
  }
}

async function saveCache(patientId: string, practiceId: string, suggestions: Array<{ code: string; rationale: string }>) {
  try {
    await pool.query(
      `INSERT INTO audit_logs (user_id, user_email, practice_id, action, resource_type, resource_id, details, severity)
       VALUES (NULL, NULL, $1, 'ai.suggested_diagnoses.cache', 'patient', $2, $3::jsonb, 'info')`,
      [practiceId, patientId, JSON.stringify({ suggestions })],
    )
  } catch {}
}

async function generate(patientId: string, practiceId: string, userEmail: string) {
  // LLM provider is wrapped by lib/aws/llm — bedrock by default, fallback to direct API.
  // We don't pre-check apiKey here because Bedrock uses task IAM not a key.

  const cap = await checkAiRateLimit(practiceId, 'ai.suggested_diagnoses.%')
  if (!cap.allowed) {
    return { error: 'daily_cap_reached', cap: cap.cap, used: cap.used, status: 429 }
  }

  const userMessage = await loadPatientContext(practiceId, patientId)
  const resp = await createMessage({
    model: 'claude-sonnet-4-6',
    max_tokens: 800,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  })

  const text = resp.content
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('')
    .trim()

  let parsed: { suggestions: Array<{ code: string; rationale: string }> }
  try {
    // Sonnet sometimes wraps with ```json fences — strip them
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
    parsed = JSON.parse(cleaned)
  } catch (err) {
    throw new Error('Sonnet returned non-JSON response')
  }

  // Filter to whitelist only (safety net — Sonnet sometimes drifts)
  const allowed = new Set(ICD10_CODES.map((c: Code) => c.code))
  const filtered = (parsed.suggestions || []).filter(s => allowed.has(s.code)).slice(0, 3)

  await saveCache(patientId, practiceId, filtered)
  await auditEhrAccess({
    ctx: { practiceId, patientId, userEmail } as any,
    action: 'ai.suggested_diagnoses.generated',
    severity: 'info',
    details: { count: filtered.length, codes: filtered.map(s => s.code) },
  }).catch(() => {})

  return { suggestions: filtered, generated_at: new Date().toISOString(), status: 200 }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id } = await params
  if (!ctx.practiceId) return NextResponse.json({ error: 'no_practice' }, { status: 403 })

  const cached = await loadCached(id)
  if (cached) return NextResponse.json({ ...cached, source: 'cache' })

  // No cache — generate fresh
  try {
    const result = await generate(id, ctx.practiceId, ctx.session.email)
    if (result.status !== 200) return NextResponse.json(result, { status: result.status })
    return NextResponse.json({ suggestions: result.suggestions, generated_at: result.generated_at, source: 'fresh' })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id } = await params
  if (!ctx.practiceId) return NextResponse.json({ error: 'no_practice' }, { status: 403 })

  try {
    const result = await generate(id, ctx.practiceId, ctx.session.email)
    if (result.status !== 200) return NextResponse.json(result, { status: result.status })
    return NextResponse.json({ suggestions: result.suggestions, generated_at: result.generated_at, source: 'fresh' })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
