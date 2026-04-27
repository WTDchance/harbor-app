// app/api/ehr/notes/clean-transcript/route.ts
//
// Wave 38 M2 — "AI clean into [format]" button on NoteEditor.
//
// Therapist dictates voice memo → /api/transcribe returns raw transcript
// text → therapist taps "AI clean" → this route asks Sonnet (via Bedrock)
// to restructure that transcript into the patient's preferred note format
// (SOAP / DAP / BIRP / GIRP / Narrative). We do NOT persist anything; the
// client overwrites the open form fields with the response. Therapist
// remains the author of record and must hit Save themselves.
//
// HIPAA: Sonnet runs on Bedrock under the AWS BAA; transcript text is
// transient -- only the eventual saved note is persistent PHI in RDS.
//
// Body: { transcript: string, format: 'soap' | 'dap' | 'birp' | 'girp' | 'freeform', patient_id?: string }
// Response: { fields: { subjective?, objective?, assessment?, plan?, body? }, summary, flagged_concerns }

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
import { checkDraftRateLimit } from '@/lib/aws/ehr/draft-rate-limit'
import { createMessage } from '@/lib/aws/llm'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Format = 'soap' | 'dap' | 'birp' | 'girp' | 'freeform'

const FORMAT_INSTRUCTIONS: Record<Format, string> = {
  soap: `Restructure into SOAP. Keys: subjective, objective, assessment, plan.
- Subjective: what the patient reported in their own framing (mood, symptoms, life events).
- Objective: observable in the session (affect, behavior, MSE-relevant data). NEVER fabricate physical findings; if the dictation didn't mention them, write "Not assessed this session."
- Assessment: clinical impression, progress against goals.
- Plan: concrete next steps (homework, referrals, frequency, interventions).`,
  dap: `Restructure into DAP. Keys: subjective ("data" — combine self-report + observation), objective (LEAVE EMPTY), assessment, plan.`,
  birp: `Restructure into BIRP. Keys: subjective ("behavior"), objective ("intervention"), assessment ("response"), plan.`,
  girp: `Restructure into GIRP. Keys: subjective ("goal"), objective ("intervention"), assessment ("response"), plan.`,
  freeform: `Produce a single coherent narrative paragraph or two suitable for a freeform/narrative note. Keys: body. Do not split into sections.`,
}

function systemPrompt(format: Format): string {
  return `You are a clinical documentation assistant helping a licensed therapist clean up a voice-dictated session note.

The therapist dictated the contents of a recently-finished therapy session. Your job is to restructure their dictation into the requested note format. You are NOT generating new clinical content -- only reorganizing what was dictated.

Critical rules:
1. Do NOT invent details. If a section has nothing from the dictation, write "Not assessed this session." Do not fabricate MSE findings, body language, or diagnostic impressions the therapist didn't dictate.
2. Use clinical language but keep the therapist's voice. Don't over-formalize.
3. Write in third person about the patient. Don't use first person ("I told them…") -- transform into third person ("therapist suggested…").
4. If the dictation mentions safety concerns (suicidality, self-harm, abuse), surface them prominently in flagged_concerns.
5. Keep each section to 3-6 sentences unless the dictation truly has more substance.

${FORMAT_INSTRUCTIONS[format]}

Output format: return ONLY a JSON object:
{
  "subjective": string | null,
  "objective": string | null,
  "assessment": string | null,
  "plan": string | null,
  "body": string | null,
  "summary": string,
  "flagged_concerns": string[]
}

Use null for keys not relevant to the requested format. Return ONLY the JSON, no markdown fences, no preamble.`
}

function safeParseJson(s: string): any {
  try {
    return JSON.parse(s)
  } catch {
    // Strip code fences if Sonnet ignored the instruction
    const m = s.match(/```(?:json)?\s*([\s\S]+?)\s*```/)
    if (m) {
      try { return JSON.parse(m[1]) } catch {}
    }
    return null
  }
}

const VALID_FORMATS: Format[] = ['soap', 'dap', 'birp', 'girp', 'freeform']

export async function POST(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  let body: any
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const transcript: string = String(body?.transcript || '').trim()
  const formatRaw: string = String(body?.format || 'soap').toLowerCase()
  const format = (VALID_FORMATS as string[]).includes(formatRaw) ? (formatRaw as Format) : 'soap'
  const patientId: string | null = body?.patient_id ? String(body.patient_id) : null

  if (transcript.length < 10) {
    return NextResponse.json({ error: 'transcript too short' }, { status: 400 })
  }
  if (transcript.length > 50_000) {
    return NextResponse.json({ error: 'transcript too long' }, { status: 413 })
  }

  // Reuse the AI-draft rate limit so a runaway client can't blow up our
  // Bedrock budget.
  const limit = await checkDraftRateLimit(ctx.practiceId!)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'rate_limit_exceeded', used: limit.used, cap: limit.cap },
      { status: 429 },
    )
  }

  const userMessage = `Therapist dictation (verbatim transcript from a just-finished session):\n\n${transcript}\n\nRestructure into the requested format.`

  let resp
  try {
    resp = await createMessage({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      temperature: 0.2,
      system: systemPrompt(format),
      messages: [{ role: 'user', content: userMessage }],
    } as any)
  } catch (err) {
    console.error('[clean-transcript] LLM failed', (err as Error).message)
    return NextResponse.json({ error: 'llm_failed' }, { status: 502 })
  }

  const text = resp.content
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('')
    .trim()

  const parsed = safeParseJson(text)
  if (!parsed) {
    return NextResponse.json({ error: 'llm_returned_invalid_json' }, { status: 502 })
  }

  const fields = {
    subjective: typeof parsed.subjective === 'string' ? parsed.subjective : null,
    objective: typeof parsed.objective === 'string' ? parsed.objective : null,
    assessment: typeof parsed.assessment === 'string' ? parsed.assessment : null,
    plan: typeof parsed.plan === 'string' ? parsed.plan : null,
    body: typeof parsed.body === 'string' ? parsed.body : null,
  }
  const summary = typeof parsed.summary === 'string' ? parsed.summary : ''
  const flagged_concerns = Array.isArray(parsed.flagged_concerns)
    ? parsed.flagged_concerns.filter((s: unknown) => typeof s === 'string')
    : []

  await auditEhrAccess({
    ctx,
    action: 'note.draft.transcribe',
    resourceType: 'ehr_progress_note',
    resourceId: null,
    details: {
      via: 'aws_transcribe_clean',
      format,
      patient_id: patientId,
      transcript_chars: transcript.length,
      flagged_concerns,
    },
  })

  return NextResponse.json({ fields, summary, flagged_concerns })
}
