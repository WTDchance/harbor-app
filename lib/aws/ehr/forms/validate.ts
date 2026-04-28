// lib/aws/ehr/forms/validate.ts
//
// W47 T2 — question shape validator for custom forms. Mirrors the
// W46 T4 assessments validator but without the scoring fields.

export type QuestionType =
  | 'likert_1_5'
  | 'likert_0_4'
  | 'yes_no'
  | 'numeric'
  | 'free_text'
  | 'multiple_choice'

export interface FormQuestion {
  id: string
  text: string
  type: QuestionType
  choices?: Array<{ value: number; label: string }>
  required?: boolean
}

export const FORM_KINDS = ['intake', 'reflection', 'satisfaction', 'roi_request', 'custom'] as const
export type FormKind = (typeof FORM_KINDS)[number]

export function validateFormQuestions(raw: unknown):
  | { ok: true; questions: FormQuestion[] }
  | { ok: false; error: string }
{
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, error: 'at_least_one_question_required' }
  }
  const validTypes: QuestionType[] = ['likert_1_5','likert_0_4','yes_no','numeric','free_text','multiple_choice']
  const out: FormQuestion[] = []
  const seen = new Set<string>()
  for (const item of raw as any[]) {
    if (!item || typeof item !== 'object') return { ok: false, error: 'invalid_question_shape' }
    const id = String(item.id || '').trim() || `q${out.length + 1}`
    if (seen.has(id)) return { ok: false, error: `duplicate_question_id:${id}` }
    const text = String(item.text || '').trim()
    if (!text) return { ok: false, error: 'question_text_required' }
    if (!validTypes.includes(item.type)) return { ok: false, error: `invalid_question_type:${item.type}` }
    const q: FormQuestion = {
      id,
      text: text.slice(0, 500),
      type: item.type,
      required: !!item.required,
    }
    if (item.type === 'multiple_choice') {
      if (!Array.isArray(item.choices) || item.choices.length === 0) {
        return { ok: false, error: 'multiple_choice_requires_choices' }
      }
      q.choices = item.choices.map((c: any) => ({
        value: Number(c.value) || 0,
        label: String(c.label || '').slice(0, 200),
      }))
    }
    out.push(q)
    seen.add(id)
  }
  return { ok: true, questions: out }
}
