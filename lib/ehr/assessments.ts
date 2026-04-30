// lib/ehr/assessments.ts
//
// W52 D2 — pure scoring + crisis-detection helpers for the validated
// assessment library.

export interface AssessmentDefinition {
  slug: string
  name: string
  question_count: number
  questions: AssessmentQuestion[]
  scoring_rules: ScoringRules
  call_administrable: boolean
  scope: string
}

export interface AssessmentQuestion {
  id: string
  text: string
  scale: string
  crisis_question?: boolean
}

export interface ScoringRules {
  scale?: string
  scale_values?: Record<string, number>
  sum_thresholds?: { min: number; max: number; label: string }[]
  crisis_triggers?: {
    question_id: string
    values: string[]
    action: string
    escalate_to?: string
    escalate_severity?: 'info' | 'warning' | 'critical'
  }[]
  escalate_on_positive?: string
}

export interface AssessmentResponse {
  question_id: string
  value: string | number
}

export interface ScoredAssessment {
  raw_score: number | null
  severity_label: string | null
  crisis_flagged: boolean
  crisis_reasons: string[]
  escalate_to: string | null
  escalate_severity: 'info' | 'warning' | 'critical'
}

export function scoreAssessment(
  def: Pick<AssessmentDefinition, 'questions' | 'scoring_rules'>,
  responses: AssessmentResponse[],
): ScoredAssessment {
  const rules = def.scoring_rules
  const map = rules.scale_values ?? {}
  let total = 0
  let scored = 0
  for (const r of responses) {
    if (typeof r.value === 'number' && Number.isFinite(r.value)) {
      total += r.value; scored += 1; continue
    }
    const v = map[String(r.value)]
    if (typeof v === 'number') { total += v; scored += 1 }
  }

  let label: string | null = null
  if (scored > 0 && Array.isArray(rules.sum_thresholds)) {
    const hit = rules.sum_thresholds.find(t => total >= t.min && total <= t.max)
    label = hit?.label ?? null
  }

  let crisisFlagged = false
  const crisisReasons: string[] = []
  let escalateSeverity: ScoredAssessment['escalate_severity'] = 'info'
  let escalateTo: string | null = null

  for (const trig of rules.crisis_triggers ?? []) {
    const r = responses.find(x => x.question_id === trig.question_id)
    if (!r) continue
    const matches = trig.values.includes(String(r.value))
    if (matches) {
      crisisFlagged = true
      crisisReasons.push(`${trig.question_id}: ${String(r.value)}`)
      if (trig.escalate_to && !escalateTo) escalateTo = trig.escalate_to
      const sev = trig.escalate_severity ?? 'critical'
      if (sev === 'critical') escalateSeverity = 'critical'
      else if (sev === 'warning' && escalateSeverity !== 'critical') escalateSeverity = 'warning'
    }
  }

  // PHQ-2 / GAD-2 escalation: positive screen → schedule the longer instrument.
  if (!escalateTo && rules.escalate_on_positive && label === 'positive_screen') {
    escalateTo = rules.escalate_on_positive
  }

  return {
    raw_score: scored > 0 ? total : null,
    severity_label: label,
    crisis_flagged: crisisFlagged,
    crisis_reasons: crisisReasons,
    escalate_to: escalateTo,
    escalate_severity: crisisFlagged ? escalateSeverity : 'info',
  }
}

export function severityToBand(label: string | null): 'low' | 'medium' | 'high' {
  if (!label) return 'low'
  const high = ['severe', 'high_risk', 'probable_ptsd', 'moderately_severe', 'positive_screen']
  const medium = ['moderate', 'mild', 'active_ideation']
  if (high.includes(label)) return 'high'
  if (medium.includes(label)) return 'medium'
  return 'low'
}
