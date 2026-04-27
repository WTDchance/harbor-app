// lib/ehr/draft-note.ts
// Harbor EHR — Sonnet-powered draft generator.
//
// Given a call transcript, produce a structured SOAP draft the therapist
// can review, edit, and sign. Never auto-sign — the therapist is always the
// author of record.

import { createMessage } from '@/lib/aws/llm'


export type DraftSoap = {
  title: string
  subjective: string
  objective: string
  assessment: string
  plan: string
  suggested_cpt_codes: string[]
  suggested_icd10_codes: string[]
  summary_for_review: string
  flagged_concerns: string[]
}

const SYSTEM_PROMPT = `You are a clinical documentation assistant helping a licensed therapist draft a progress note from a phone-call transcript. The call may be an intake screening or a follow-up contact — infer from context.

Your job is to produce a SOAP-format draft. Be brief, clinical, and factual.

Critical rules:
1. Do NOT invent details. If a section has nothing to report from the transcript, write "Not assessed in this call." Do not fabricate a mental status exam, clinical observations that weren't made, or diagnoses that weren't indicated.
2. Use clinical language but not jargon the therapist would have to rewrite. Write the way a therapist would write it themselves.
3. The Objective section, on a phone call, is limited. Note observable things like tone, affect inferred from speech, and verbal reports. Do NOT fabricate body language, eye contact, or physical MSE findings.
4. In Assessment, offer a provisional impression, clearly marked as provisional. Do not diagnose definitively from a single call.
5. In Plan, capture concrete next steps mentioned in the call (scheduled appointment, intake forms sent, referrals discussed, crisis resources offered).
6. Suggest CPT codes only if the call type clearly matches (e.g., 90791 for intake/diagnostic evaluation). If unsure, leave empty.
7. Suggest ICD-10 codes as provisional working impressions only — flag in flagged_concerns that these must be confirmed by the therapist.
8. If the transcript contains any crisis content (suicidality, self-harm, abuse disclosure, substance emergency), surface it prominently in flagged_concerns and incorporate into the Assessment. Do NOT minimize.
9. Write in third person referring to the caller/patient. Do not use first-person ("I told the patient...").
10. Keep each SOAP section to 3-6 sentences unless the call genuinely has more substance.

Output format: return ONLY a JSON object with these exact keys:
{
  "title": string (short descriptive note title, e.g. "Intake call — anxiety, panic"),
  "subjective": string,
  "objective": string,
  "assessment": string,
  "plan": string,
  "suggested_cpt_codes": string[] (may be empty),
  "suggested_icd10_codes": string[] (may be empty; always provisional),
  "summary_for_review": string (one-sentence recap of what the note captures),
  "flagged_concerns": string[] (explicit things the therapist should double-check: unclear claims, crisis flags, missing data)
}

Return ONLY the JSON. No preamble, no markdown fence, no commentary.`

export async function draftNoteFromTranscript(args: {
  transcript: string
  callMetadata?: {
    call_type?: string | null
    session_type?: string | null
    duration_seconds?: number | null
    created_at?: string | null
    caller_name?: string | null
    reason_for_calling?: string | null
    crisis_detected?: boolean | null
  }
  patientContext?: {
    first_name?: string | null
    last_name?: string | null
  }
}): Promise<DraftSoap> {
  // LLM provider check is delegated to lib/aws/llm — Bedrock by default,
  // falls back to ANTHROPIC_API_KEY if set. Either way createMessage
  // throws clearly if neither path is available.

  const meta = args.callMetadata ?? {}
  const metaLines: string[] = []
  if (meta.call_type) metaLines.push(`call_type: ${meta.call_type}`)
  if (meta.session_type) metaLines.push(`session_type: ${meta.session_type}`)
  if (meta.duration_seconds) metaLines.push(`duration: ${meta.duration_seconds}s`)
  if (meta.created_at) metaLines.push(`call_date: ${meta.created_at}`)
  if (meta.reason_for_calling) metaLines.push(`reason_for_calling: ${meta.reason_for_calling}`)
  if (meta.crisis_detected) metaLines.push(`crisis_detected_by_system: true`)
  if (args.patientContext?.first_name) {
    const name = [args.patientContext.first_name, args.patientContext.last_name].filter(Boolean).join(' ')
    if (name) metaLines.push(`patient: ${name}`)
  }

  const userMessage = [
    metaLines.length ? `Call metadata:\n${metaLines.join('\n')}\n` : '',
    `Transcript:\n${args.transcript.trim()}`,
  ].join('\n')

  const resp = await createMessage({
    model: 'claude-sonnet-4-6',
    max_tokens: 2000,
    temperature: 0.2,
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: userMessage }],
  })

  const text = resp.content
    .filter(b => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim()

  const parsed = safeParseJson(text)
  if (!parsed) {
    throw new Error('Sonnet did not return valid JSON. Raw output: ' + text.slice(0, 200))
  }

  return normalize(parsed)
}

function safeParseJson(raw: string): any {
  // Strip markdown fence if Sonnet slipped one in despite instructions.
  const stripped = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim()
  try {
    return JSON.parse(stripped)
  } catch {
    // Try to recover the outermost JSON object if extra text crept in.
    const m = stripped.match(/\{[\s\S]*\}/)
    if (!m) return null
    try { return JSON.parse(m[0]) } catch { return null }
  }
}

// ---------------------------------------------------------------------------
// Brief-to-SOAP — the primary AI draft flow.
//
// Therapist types a short freeform brief of what happened in the session
// ("Session 5, worked on breathing techniques, pt discussed conflict with
// spouse, assigned thought log homework"). Sonnet expands into a full SOAP
// draft using clinical language, informed by the patient's recent history.
// ---------------------------------------------------------------------------

const BRIEF_SYSTEM_PROMPT = `You are a clinical documentation assistant helping a licensed therapist turn their shorthand session brief into a formal SOAP progress note.

Input: a short, informal description from the therapist about what happened during a therapy session.
Output: a full SOAP-format draft the therapist will review, edit, and sign.

Critical rules:
1. Stay faithful to what the therapist wrote. Do NOT fabricate content, specific quotes, or clinical events that weren't in the brief.
2. Expand appropriately — a brief saying "worked on breathing techniques, pt discussed conflict with spouse" can become 2-3 sentences per section using standard clinical language — but do not invent details (e.g., specific techniques not named, specific emotions not mentioned).
3. If a section has nothing the therapist mentioned, write a brief neutral placeholder like "Not specified in this entry." Do not invent to fill space.
4. If patient history (recent notes, assessments) is provided, you may reference it thinly in Assessment to contextualize (e.g., "continues to work on anxiety as in prior sessions"). Do not paste history content into the note body.
5. Write in third person referring to the patient. Do not use first person ("I worked with the patient").
6. Use clinical language but not jargon that obscures meaning — write the way the therapist would write themselves.
7. In Assessment, provide a brief clinical impression consistent with what the therapist reported. Do NOT diagnose or upgrade the clinical picture beyond the brief.
8. In Plan, capture homework, techniques to continue, next-session focus, referrals — only if the therapist mentioned them. If not mentioned, write "To be determined at next session" or similar.
9. Suggest CPT codes based on the implied session type (90834 for 45-min individual, 90837 for 60-min, 90791 for intake). If not obvious, leave empty.
10. Suggest ICD-10 codes ONLY if the brief clearly points at a diagnosis context; always provisional, flag in flagged_concerns.
11. If the brief suggests a crisis, safety concern, or risk issue, flag it prominently and incorporate into Assessment.

Output format: return ONLY a JSON object with these exact keys:
{
  "title": string (short descriptive note title),
  "subjective": string,
  "objective": string,
  "assessment": string,
  "plan": string,
  "suggested_cpt_codes": string[] (may be empty),
  "suggested_icd10_codes": string[] (may be empty; always provisional),
  "summary_for_review": string (one-sentence recap),
  "flagged_concerns": string[] (things the therapist should double-check before signing)
}

Return ONLY the JSON. No preamble, no markdown fence, no commentary.`

export type HistoryContext = {
  recent_notes?: Array<{
    title: string
    note_format: string
    created_at: string
    assessment?: string | null
    plan?: string | null
  }>
  recent_assessments?: Array<{
    instrument: string
    score: number | string
    date: string
  }>
}

export async function draftNoteFromBrief(args: {
  brief: string
  patientContext?: {
    first_name?: string | null
    last_name?: string | null
    reason_for_seeking?: string | null
  }
  history?: HistoryContext
}): Promise<DraftSoap> {
  // LLM provider check is delegated to lib/aws/llm — Bedrock by default,
  // falls back to ANTHROPIC_API_KEY if set. Either way createMessage
  // throws clearly if neither path is available.

  const brief = args.brief.trim()
  if (brief.length < 4) throw new Error('Brief is too short.')

  const parts: string[] = []
  if (args.patientContext) {
    const p = args.patientContext
    const nameBits = [p.first_name, p.last_name].filter(Boolean)
    if (nameBits.length) parts.push(`Patient: ${nameBits.join(' ')}`)
    if (p.reason_for_seeking) parts.push(`Initial reason for seeking care: ${p.reason_for_seeking}`)
  }

  if (args.history?.recent_notes?.length) {
    parts.push('\nRecent prior notes (for context only — do not paste into this note):')
    for (const n of args.history.recent_notes.slice(0, 3)) {
      const bits: string[] = [`- ${n.title} [${n.note_format.toUpperCase()}, ${n.created_at}]`]
      if (n.assessment) bits.push(`  Assessment: ${truncate(n.assessment, 200)}`)
      if (n.plan) bits.push(`  Plan: ${truncate(n.plan, 200)}`)
      parts.push(bits.join('\n'))
    }
  }

  if (args.history?.recent_assessments?.length) {
    parts.push('\nRecent assessments:')
    for (const a of args.history.recent_assessments.slice(0, 5)) {
      parts.push(`- ${a.instrument} ${a.score} (${a.date})`)
    }
  }

  parts.push(`\nTherapist brief:\n${brief}`)

  const userMessage = parts.join('\n')

  const resp = await createMessage({
    model: 'claude-sonnet-4-6',
    max_tokens: 2000,
    temperature: 0.3,
    system: [
      {
        type: 'text',
        text: BRIEF_SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: userMessage }],
  })

  const text = resp.content
    .filter(b => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim()

  const parsed = safeParseJson(text)
  if (!parsed) throw new Error('Sonnet did not return valid JSON.')
  return normalize(parsed)
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

function normalize(p: any): DraftSoap {
  const arr = (x: any): string[] =>
    Array.isArray(x) ? x.filter((v) => typeof v === 'string' && v.trim()).map((v) => v.trim()) : []
  const s = (x: any, fallback = ''): string =>
    typeof x === 'string' && x.trim() ? x.trim() : fallback

  return {
    title: s(p.title, 'Progress note'),
    subjective: s(p.subjective, 'Not assessed in this call.'),
    objective: s(p.objective, 'Not assessed in this call.'),
    assessment: s(p.assessment, 'Not assessed in this call.'),
    plan: s(p.plan, 'Not assessed in this call.'),
    suggested_cpt_codes: arr(p.suggested_cpt_codes),
    suggested_icd10_codes: arr(p.suggested_icd10_codes),
    summary_for_review: s(p.summary_for_review),
    flagged_concerns: arr(p.flagged_concerns),
  }
}
