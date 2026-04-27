// app/api/ehr/patients/[id]/suggested-goals/route.ts
//
// Wave 33 — Sonnet-suggested treatment plan goals for a patient. Reads
// the working diagnoses (passed as query param or pulled from active
// treatment plan), recent assessments, intake, and presenting concerns,
// then returns 3 evidence-anchored treatment goals plus 2 candidate
// objectives per goal. The therapist can accept any of them with one
// click, edit them, or write their own.
//
// GET ?diagnoses=F33.1,F41.1 — returns cached goals (last 24h) or fresh
// POST { diagnoses?: string[] } — force regeneration

import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/aws/db'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
import { checkAiRateLimit } from '@/lib/aws/ehr/draft-rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SYSTEM_PROMPT = `You write treatment plan goals for a licensed therapist. Read the patient data + working diagnoses, then propose THREE clinically-supported goals. Each goal has 2 candidate objectives.

Goals must be:
  - SMART-flavored: specific, measurable when reasonable, achievable, time-bound (within 12 weeks unless data suggests longer).
  - Anchored to the actual data — reference assessment scores, intake answers, or presenting concerns. Don't invent symptoms or history.
  - Patient-centered phrasing: "Reduce anxiety severity" not "Treat patient's anxiety." Active voice, third person OR no person — therapist writes the actual plan.

Objectives must be:
  - Concrete clinician-or-patient actions: psychoeducation modules, exposure exercises, between-session homework, weekly journaling, etc.
  - Brief — one sentence each, ≤ 25 words.

Return ONLY this JSON shape, no prose, no markdown:
{
  "goals": [
    {
      "text": "...",
      "rationale": "(one short sentence — ≤ 20 words — explaining the data trail)",
      "objectives": ["...", "..."]
    },
    ...
  ]
}`

async function loadPatientContext(practiceId: string, patientId: string, diagnoses: string[]): Promise<string> {
  const { rows: pr } = await pool.query(
    `SELECT first_name, last_name, date_of_birth, presenting_concerns, reason_for_seeking
       FROM patients WHERE id = $1 AND practice_id = $2 LIMIT 1`,
    [patientId, practiceId],
  )
  const p = pr[0] || {}

  const { rows: ir } = await pool.query(
    `SELECT phq9_score, phq9_severity, gad7_score, gad7_severity,
            presenting_concerns, medications, prior_therapy, completed_at
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

  return `PATIENT DATA:
${JSON.stringify({
    patient: {
      name: [p.first_name, p.last_name].filter(Boolean).join(' '),
      dob: p.date_of_birth,
      presenting_concerns: p.presenting_concerns,
      reason_for_seeking: p.reason_for_seeking,
    },
    working_diagnoses: diagnoses,
    latest_intake: intake,
    recent_assessments: ar,
  }, null, 2)}`
}

async function loadCached(patientId: string, diagnoses: string[]) {
  try {
    const key = diagnoses.slice().sort().join(',')
    const { rows } = await pool.query(
      `SELECT details, timestamp FROM audit_logs
        WHERE action = 'ai.suggested_goals.cache'
          AND resource_id = $1
          AND details->>'dx_key' = $2
          AND timestamp > NOW() - INTERVAL '24 hours'
        ORDER BY timestamp DESC LIMIT 1`,
      [patientId, key],
    )
    const r = rows[0]
    if (!r) return null
    return { goals: r.details?.goals ?? [], generated_at: r.timestamp.toISOString() }
  } catch { return null }
}

async function saveCache(patientId: string, practiceId: string, diagnoses: string[], goals: any[]) {
  try {
    const key = diagnoses.slice().sort().join(',')
    await pool.query(
      `INSERT INTO audit_logs (user_id, user_email, practice_id, action, resource_type, resource_id, details, severity)
       VALUES (NULL, NULL, $1, 'ai.suggested_goals.cache', 'patient', $2, $3::jsonb, 'info')`,
      [practiceId, patientId, JSON.stringify({ goals, dx_key: key })],
    )
  } catch {}
}

async function generate(patientId: string, practiceId: string, userEmail: string, diagnoses: string[]) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('Anthropic API not configured')

  const cap = await checkAiRateLimit(practiceId, 'ai.suggested_goals.%')
  if (!cap.allowed) {
    return { error: 'daily_cap_reached', cap: cap.cap, used: cap.used, status: 429 }
  }

  const userMsg = await loadPatientContext(practiceId, patientId, diagnoses)
  const client = new Anthropic({ apiKey })
  const resp = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1500,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMsg }],
  })

  const text = resp.content
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('')
    .trim()
  let parsed: { goals: any[] }
  try {
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
    parsed = JSON.parse(cleaned)
  } catch {
    throw new Error('Sonnet returned non-JSON response')
  }

  const goals = (parsed.goals || []).slice(0, 3).map((g: any) => ({
    text: String(g.text || '').slice(0, 400),
    rationale: String(g.rationale || '').slice(0, 200),
    objectives: Array.isArray(g.objectives) ? g.objectives.slice(0, 3).map((o: any) => String(o).slice(0, 200)) : [],
  }))

  await saveCache(patientId, practiceId, diagnoses, goals)
  await auditEhrAccess({
    ctx: { practiceId, patientId, userEmail } as any,
    action: 'ai.suggested_goals.generated',
    severity: 'info',
    details: { count: goals.length, dx_count: diagnoses.length },
  }).catch(() => {})

  return { goals, generated_at: new Date().toISOString(), status: 200 }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id } = await params
  if (!ctx.practiceId) return NextResponse.json({ error: 'no_practice' }, { status: 403 })

  const dxParam = req.nextUrl.searchParams.get('diagnoses') || ''
  const diagnoses = dxParam.split(',').map(s => s.trim()).filter(Boolean)

  const cached = await loadCached(id, diagnoses)
  if (cached) return NextResponse.json({ ...cached, source: 'cache' })

  try {
    const result = await generate(id, ctx.practiceId, ctx.session.email, diagnoses)
    if (result.status !== 200) return NextResponse.json(result, { status: result.status })
    return NextResponse.json({ goals: result.goals, generated_at: result.generated_at, source: 'fresh' })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id } = await params
  if (!ctx.practiceId) return NextResponse.json({ error: 'no_practice' }, { status: 403 })

  let body: { diagnoses?: string[] }
  try { body = await req.json() } catch { body = {} }
  const diagnoses = (body.diagnoses || []).filter(Boolean)

  try {
    const result = await generate(id, ctx.practiceId, ctx.session.email, diagnoses)
    if (result.status !== 200) return NextResponse.json(result, { status: result.status })
    return NextResponse.json({ goals: result.goals, generated_at: result.generated_at, source: 'fresh' })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
