// lib/aws/ehr/assessments/score.ts
//
// W46 T4 — pure scoring functions for custom assessment templates.
// Locked to a small allow-list. NO eval, NO new Function, NO
// arbitrary expression evaluation. New scoring approaches must be
// added by editing this file + extending the CHECK constraint on
// ehr_custom_assessment_templates.scoring_function.

export type QuestionType =
  | 'likert_1_5'
  | 'likert_0_4'
  | 'yes_no'
  | 'numeric'
  | 'free_text'
  | 'multiple_choice'

export interface Question {
  id: string
  text: string
  type: QuestionType
  choices?: Array<{ value: number; label: string }>
  score_weight?: number
  reverse_scored?: boolean
  subscale?: string
}

export interface SeverityBand {
  min: number
  max: number
  label: string
  color?: string
  alert_on_threshold?: boolean
}

export type ScoringFunction =
  | 'sum'
  | 'mean'
  | 'weighted_sum'
  | 'max_subscale'
  | 'phq9_like'
  | 'gad7_like'

/** Coerce a single answer to a numeric value per question type. */
function answerToNumeric(q: Question, raw: unknown): number {
  if (q.type === 'free_text') return 0
  if (q.type === 'yes_no') return raw === true || raw === 'yes' || raw === 1 ? 1 : 0
  if (q.type === 'numeric') {
    const n = Number(raw); return Number.isFinite(n) ? n : 0
  }
  if (q.type === 'multiple_choice') {
    if (typeof raw === 'number') return raw
    const c = q.choices?.find((x) => x.label === raw)
    return c ? c.value : 0
  }
  // likert_1_5 / likert_0_4
  const n = Number(raw)
  if (!Number.isFinite(n)) return 0
  return n
}

function withReverse(q: Question, value: number): number {
  if (!q.reverse_scored) return value
  if (q.type === 'likert_1_5') return 6 - value
  if (q.type === 'likert_0_4') return 4 - value
  if (q.type === 'yes_no') return 1 - value
  return value
}

export interface ScoreResult {
  total: number
  per_subscale?: Record<string, number>
  band: SeverityBand | null
  alert: boolean
}

function findBand(total: number, bands: SeverityBand[]): SeverityBand | null {
  for (const b of bands) {
    if (total >= b.min && total <= b.max) return b
  }
  return null
}

/** Run the chosen scoring function over a question set + answers. */
export function scoreAssessment(args: {
  scoring_function: ScoringFunction
  questions: Question[]
  answers: Record<string, unknown>
  severity_bands?: SeverityBand[]
}): ScoreResult {
  const numerics = args.questions.map((q) => ({
    q,
    v: withReverse(q, answerToNumeric(q, args.answers[q.id])),
  }))

  let total = 0
  let perSubscale: Record<string, number> | undefined

  switch (args.scoring_function) {
    case 'sum':
    case 'phq9_like':
    case 'gad7_like':
      total = numerics.reduce((s, n) => s + n.v, 0)
      break
    case 'mean': {
      const meaningful = numerics.filter((n) => n.q.type !== 'free_text')
      total = meaningful.length === 0 ? 0 : meaningful.reduce((s, n) => s + n.v, 0) / meaningful.length
      break
    }
    case 'weighted_sum':
      total = numerics.reduce((s, n) => s + n.v * (n.q.score_weight ?? 1), 0)
      break
    case 'max_subscale': {
      perSubscale = {}
      for (const n of numerics) {
        const key = n.q.subscale || 'default'
        perSubscale[key] = (perSubscale[key] || 0) + n.v
      }
      total = Math.max(0, ...Object.values(perSubscale))
      break
    }
    default: {
      const _x: never = args.scoring_function
      void _x
      total = 0
    }
  }

  // Round mean to 2 decimal places for human readability; everything
  // else lands as an integer.
  if (args.scoring_function === 'mean') total = Math.round(total * 100) / 100

  const band = findBand(total, args.severity_bands || [])
  return {
    total,
    per_subscale: perSubscale,
    band,
    alert: !!band?.alert_on_threshold,
  }
}

/** Validate a question/severity-band payload before persisting. */
export function validateTemplate(args: {
  questions: unknown
  scoring_function: unknown
  severity_bands: unknown
}): { ok: true; questions: Question[]; severity_bands: SeverityBand[]; scoring_function: ScoringFunction }
  | { ok: false; error: string }
{
  if (!Array.isArray(args.questions) || args.questions.length === 0) {
    return { ok: false, error: 'at_least_one_question_required' }
  }
  if (typeof args.scoring_function !== 'string') {
    return { ok: false, error: 'scoring_function_required' }
  }
  const validFns: ScoringFunction[] = ['sum', 'mean', 'weighted_sum', 'max_subscale', 'phq9_like', 'gad7_like']
  if (!validFns.includes(args.scoring_function as ScoringFunction)) {
    return { ok: false, error: 'invalid_scoring_function' }
  }
  const questions: Question[] = []
  const seen = new Set<string>()
  const validTypes: QuestionType[] = ['likert_1_5','likert_0_4','yes_no','numeric','free_text','multiple_choice']
  for (const raw of args.questions as any[]) {
    if (!raw || typeof raw !== 'object') return { ok: false, error: 'invalid_question_shape' }
    const id = String(raw.id || '').trim() || `q${questions.length + 1}`
    if (seen.has(id)) return { ok: false, error: `duplicate_question_id:${id}` }
    const text = String(raw.text || '').trim()
    if (!text) return { ok: false, error: 'question_text_required' }
    if (!validTypes.includes(raw.type)) return { ok: false, error: `invalid_question_type:${raw.type}` }
    const q: Question = {
      id,
      text: text.slice(0, 500),
      type: raw.type,
      score_weight: typeof raw.score_weight === 'number' ? raw.score_weight : undefined,
      reverse_scored: !!raw.reverse_scored,
      subscale: raw.subscale ? String(raw.subscale).slice(0, 64) : undefined,
    }
    if (raw.type === 'multiple_choice') {
      if (!Array.isArray(raw.choices) || raw.choices.length === 0) {
        return { ok: false, error: 'multiple_choice_requires_choices' }
      }
      q.choices = raw.choices.map((c: any) => ({
        value: Number(c.value) || 0,
        label: String(c.label || '').slice(0, 200),
      }))
    }
    questions.push(q)
    seen.add(id)
  }
  const severity_bands: SeverityBand[] = []
  if (Array.isArray(args.severity_bands)) {
    for (const raw of args.severity_bands as any[]) {
      const min = Number(raw.min); const max = Number(raw.max)
      if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) continue
      severity_bands.push({
        min, max,
        label: String(raw.label || '').slice(0, 80) || 'Band',
        color: raw.color ? String(raw.color).slice(0, 32) : undefined,
        alert_on_threshold: !!raw.alert_on_threshold,
      })
    }
  }
  return {
    ok: true,
    questions, severity_bands,
    scoring_function: args.scoring_function as ScoringFunction,
  }
}
