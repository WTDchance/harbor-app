// lib/ehr/instruments.ts
// Harbor EHR — canonical instrument library.
//
// Each instrument ships with:
//   - full question list (stable IDs so answers round-trip)
//   - response options (uniform within an instrument)
//   - scoring function (sum, subscale, weighted — each defined per-instrument)
//   - severity bands with labels + color hints for the UI
//   - optional alert triggers (e.g. PHQ-9 Q9 positive => suicidal ideation flag)
//
// Normative references (pinned for audit):
//   PHQ-9 — Kroenke, Spitzer, Williams (2001). Cut-offs 5/10/15/20.
//   GAD-7 — Spitzer, Kroenke, Williams, Löwe (2006). Cut-offs 5/10/15.
//   PHQ-2 / GAD-2 — short screeners; positive at score >= 3.
//   PCL-5 — Weathers et al. (2013). Cut-off commonly 31-33 for probable PTSD.
//   AUDIT-C — Bush et al. (1998). Positive at >= 4 (men) / >= 3 (women).

export type ResponseOption = { value: number; label: string }

export type Question = {
  id: string
  text: string
  options: ResponseOption[]
}

export type SeverityBand = {
  min: number
  max: number
  label: string
  color: 'green' | 'amber' | 'orange' | 'red'
}

export type AlertRule = {
  type: string
  severity: 'warn' | 'error'
  /** Evaluated against the full answer map { [qId]: value }. Returns true when alert fires. */
  trigger: (answers: Record<string, number>) => boolean
  message: string
}

export type Instrument = {
  id: string
  name: string
  description: string
  max_score: number
  questions: Question[]
  scoring: (answers: Record<string, number>) => number
  severity: (score: number) => SeverityBand
  bands: SeverityBand[]
  alert_rules?: AlertRule[]
  /** Approx time in minutes for patient to complete */
  estimated_minutes: number
  /** Short instruction shown above the questions on the portal */
  instructions: string
}

// ---------------------------------------------------------------------------
// PHQ-9
// ---------------------------------------------------------------------------
const PHQ_OPTIONS: ResponseOption[] = [
  { value: 0, label: 'Not at all' },
  { value: 1, label: 'Several days' },
  { value: 2, label: 'More than half the days' },
  { value: 3, label: 'Nearly every day' },
]
const PHQ9_BANDS: SeverityBand[] = [
  { min: 0,  max: 4,  label: 'Minimal',             color: 'green' },
  { min: 5,  max: 9,  label: 'Mild',                color: 'amber' },
  { min: 10, max: 14, label: 'Moderate',            color: 'orange' },
  { min: 15, max: 19, label: 'Moderately severe',   color: 'orange' },
  { min: 20, max: 27, label: 'Severe',              color: 'red' },
]

export const PHQ_9: Instrument = {
  id: 'PHQ-9',
  name: 'PHQ-9 — Depression',
  description: 'Patient Health Questionnaire, 9-item. Standard depression screener.',
  max_score: 27,
  estimated_minutes: 3,
  instructions:
    'Over the last 2 weeks, how often have you been bothered by any of the following problems?',
  questions: [
    { id: 'phq9_1', text: 'Little interest or pleasure in doing things', options: PHQ_OPTIONS },
    { id: 'phq9_2', text: 'Feeling down, depressed, or hopeless', options: PHQ_OPTIONS },
    { id: 'phq9_3', text: 'Trouble falling or staying asleep, or sleeping too much', options: PHQ_OPTIONS },
    { id: 'phq9_4', text: 'Feeling tired or having little energy', options: PHQ_OPTIONS },
    { id: 'phq9_5', text: 'Poor appetite or overeating', options: PHQ_OPTIONS },
    { id: 'phq9_6', text: 'Feeling bad about yourself — or that you are a failure or have let yourself or your family down', options: PHQ_OPTIONS },
    { id: 'phq9_7', text: 'Trouble concentrating on things, such as reading the newspaper or watching television', options: PHQ_OPTIONS },
    { id: 'phq9_8', text: 'Moving or speaking so slowly that other people could have noticed — or the opposite, being so fidgety or restless that you have been moving around a lot more than usual', options: PHQ_OPTIONS },
    { id: 'phq9_9', text: 'Thoughts that you would be better off dead, or of hurting yourself in some way', options: PHQ_OPTIONS },
  ],
  scoring: (a) => sumIds(a, ['phq9_1','phq9_2','phq9_3','phq9_4','phq9_5','phq9_6','phq9_7','phq9_8','phq9_9']),
  bands: PHQ9_BANDS,
  severity: (s) => bandFor(s, PHQ9_BANDS),
  alert_rules: [
    {
      type: 'suicidal_ideation',
      severity: 'error',
      trigger: (a) => (a.phq9_9 ?? 0) > 0,
      message: 'Item 9 (self-harm ideation) endorsed. Clinical review required within 24 hours.',
    },
  ],
}

// ---------------------------------------------------------------------------
// GAD-7
// ---------------------------------------------------------------------------
const GAD_OPTIONS = PHQ_OPTIONS // same 0-3 scale
const GAD7_BANDS: SeverityBand[] = [
  { min: 0,  max: 4,  label: 'Minimal',  color: 'green' },
  { min: 5,  max: 9,  label: 'Mild',     color: 'amber' },
  { min: 10, max: 14, label: 'Moderate', color: 'orange' },
  { min: 15, max: 21, label: 'Severe',   color: 'red' },
]

export const GAD_7: Instrument = {
  id: 'GAD-7',
  name: 'GAD-7 — Anxiety',
  description: 'Generalized Anxiety Disorder, 7-item. Standard anxiety screener.',
  max_score: 21,
  estimated_minutes: 2,
  instructions:
    'Over the last 2 weeks, how often have you been bothered by the following problems?',
  questions: [
    { id: 'gad7_1', text: 'Feeling nervous, anxious, or on edge', options: GAD_OPTIONS },
    { id: 'gad7_2', text: 'Not being able to stop or control worrying', options: GAD_OPTIONS },
    { id: 'gad7_3', text: 'Worrying too much about different things', options: GAD_OPTIONS },
    { id: 'gad7_4', text: 'Trouble relaxing', options: GAD_OPTIONS },
    { id: 'gad7_5', text: 'Being so restless that it is hard to sit still', options: GAD_OPTIONS },
    { id: 'gad7_6', text: 'Becoming easily annoyed or irritable', options: GAD_OPTIONS },
    { id: 'gad7_7', text: 'Feeling afraid, as if something awful might happen', options: GAD_OPTIONS },
  ],
  scoring: (a) => sumIds(a, ['gad7_1','gad7_2','gad7_3','gad7_4','gad7_5','gad7_6','gad7_7']),
  bands: GAD7_BANDS,
  severity: (s) => bandFor(s, GAD7_BANDS),
}

// ---------------------------------------------------------------------------
// PHQ-2 / GAD-2 (short screeners)
// ---------------------------------------------------------------------------
const SCREEN_BANDS: SeverityBand[] = [
  { min: 0, max: 2, label: 'Negative screen', color: 'green' },
  { min: 3, max: 6, label: 'Positive screen — follow up',  color: 'red' },
]

export const PHQ_2: Instrument = {
  id: 'PHQ-2',
  name: 'PHQ-2 — Depression screener',
  description: 'Ultra-brief depression screen. Positive at ≥3 — administer full PHQ-9.',
  max_score: 6,
  estimated_minutes: 1,
  instructions: 'Over the last 2 weeks, how often have you been bothered by:',
  questions: [
    { id: 'phq2_1', text: 'Little interest or pleasure in doing things', options: PHQ_OPTIONS },
    { id: 'phq2_2', text: 'Feeling down, depressed, or hopeless', options: PHQ_OPTIONS },
  ],
  scoring: (a) => sumIds(a, ['phq2_1','phq2_2']),
  bands: SCREEN_BANDS,
  severity: (s) => bandFor(s, SCREEN_BANDS),
}

export const GAD_2: Instrument = {
  id: 'GAD-2',
  name: 'GAD-2 — Anxiety screener',
  description: 'Ultra-brief anxiety screen. Positive at ≥3 — administer full GAD-7.',
  max_score: 6,
  estimated_minutes: 1,
  instructions: 'Over the last 2 weeks, how often have you been bothered by:',
  questions: [
    { id: 'gad2_1', text: 'Feeling nervous, anxious, or on edge', options: GAD_OPTIONS },
    { id: 'gad2_2', text: 'Not being able to stop or control worrying', options: GAD_OPTIONS },
  ],
  scoring: (a) => sumIds(a, ['gad2_1','gad2_2']),
  bands: SCREEN_BANDS,
  severity: (s) => bandFor(s, SCREEN_BANDS),
}

// ---------------------------------------------------------------------------
// PCL-5 (PTSD Checklist for DSM-5, 20 items)
// ---------------------------------------------------------------------------
const PCL_OPTIONS: ResponseOption[] = [
  { value: 0, label: 'Not at all' },
  { value: 1, label: 'A little bit' },
  { value: 2, label: 'Moderately' },
  { value: 3, label: 'Quite a bit' },
  { value: 4, label: 'Extremely' },
]
const PCL5_BANDS: SeverityBand[] = [
  { min: 0,  max: 30, label: 'Below threshold', color: 'green' },
  { min: 31, max: 45, label: 'Probable PTSD — moderate', color: 'orange' },
  { min: 46, max: 80, label: 'Probable PTSD — severe',   color: 'red' },
]

export const PCL_5: Instrument = {
  id: 'PCL-5',
  name: 'PCL-5 — PTSD checklist',
  description: 'Post-Traumatic Stress Disorder Checklist for DSM-5, 20 items.',
  max_score: 80,
  estimated_minutes: 8,
  instructions:
    'This questionnaire asks about problems you may have had after a very stressful experience. How much have you been bothered by each problem in the past month?',
  questions: [
    { id: 'pcl5_1',  text: 'Repeated, disturbing, and unwanted memories of the stressful experience', options: PCL_OPTIONS },
    { id: 'pcl5_2',  text: 'Repeated, disturbing dreams of the stressful experience', options: PCL_OPTIONS },
    { id: 'pcl5_3',  text: 'Suddenly feeling or acting as if the stressful experience were actually happening again', options: PCL_OPTIONS },
    { id: 'pcl5_4',  text: 'Feeling very upset when something reminded you of the stressful experience', options: PCL_OPTIONS },
    { id: 'pcl5_5',  text: 'Strong physical reactions when reminded of the stressful experience', options: PCL_OPTIONS },
    { id: 'pcl5_6',  text: 'Avoiding memories, thoughts, or feelings related to the stressful experience', options: PCL_OPTIONS },
    { id: 'pcl5_7',  text: 'Avoiding external reminders of the stressful experience', options: PCL_OPTIONS },
    { id: 'pcl5_8',  text: 'Trouble remembering important parts of the stressful experience', options: PCL_OPTIONS },
    { id: 'pcl5_9',  text: 'Having strong negative beliefs about yourself, other people, or the world', options: PCL_OPTIONS },
    { id: 'pcl5_10', text: 'Blaming yourself or someone else for the stressful experience or what happened after it', options: PCL_OPTIONS },
    { id: 'pcl5_11', text: 'Having strong negative feelings such as fear, horror, anger, guilt, or shame', options: PCL_OPTIONS },
    { id: 'pcl5_12', text: 'Loss of interest in activities that you used to enjoy', options: PCL_OPTIONS },
    { id: 'pcl5_13', text: 'Feeling distant or cut off from other people', options: PCL_OPTIONS },
    { id: 'pcl5_14', text: 'Trouble experiencing positive feelings', options: PCL_OPTIONS },
    { id: 'pcl5_15', text: 'Irritable behavior, angry outbursts, or acting aggressively', options: PCL_OPTIONS },
    { id: 'pcl5_16', text: 'Taking too many risks or doing things that could cause you harm', options: PCL_OPTIONS },
    { id: 'pcl5_17', text: 'Being "super-alert" or watchful or on guard', options: PCL_OPTIONS },
    { id: 'pcl5_18', text: 'Feeling jumpy or easily startled', options: PCL_OPTIONS },
    { id: 'pcl5_19', text: 'Having difficulty concentrating', options: PCL_OPTIONS },
    { id: 'pcl5_20', text: 'Trouble falling or staying asleep', options: PCL_OPTIONS },
  ],
  scoring: (a) => {
    let sum = 0
    for (let i = 1; i <= 20; i++) sum += a[`pcl5_${i}`] ?? 0
    return sum
  },
  bands: PCL5_BANDS,
  severity: (s) => bandFor(s, PCL5_BANDS),
}

// ---------------------------------------------------------------------------
// AUDIT-C (alcohol use, 3 items)
// ---------------------------------------------------------------------------
const AUDITC_BANDS: SeverityBand[] = [
  { min: 0, max: 2,  label: 'Low risk',    color: 'green' },
  { min: 3, max: 4,  label: 'At-risk',     color: 'amber' },
  { min: 5, max: 7,  label: 'Hazardous',   color: 'orange' },
  { min: 8, max: 12, label: 'High risk',   color: 'red' },
]

export const AUDIT_C: Instrument = {
  id: 'AUDIT-C',
  name: 'AUDIT-C — Alcohol use',
  description: 'Alcohol Use Disorders Identification Test — Consumption (3 items).',
  max_score: 12,
  estimated_minutes: 1,
  instructions: 'These questions are about your use of alcoholic beverages over the past year.',
  questions: [
    {
      id: 'auditc_1',
      text: 'How often did you have a drink containing alcohol in the past year?',
      options: [
        { value: 0, label: 'Never' },
        { value: 1, label: 'Monthly or less' },
        { value: 2, label: '2–4 times a month' },
        { value: 3, label: '2–3 times a week' },
        { value: 4, label: '4 or more times a week' },
      ],
    },
    {
      id: 'auditc_2',
      text: 'How many drinks containing alcohol did you have on a typical day when drinking in the past year?',
      options: [
        { value: 0, label: '1 or 2' },
        { value: 1, label: '3 or 4' },
        { value: 2, label: '5 or 6' },
        { value: 3, label: '7 to 9' },
        { value: 4, label: '10 or more' },
      ],
    },
    {
      id: 'auditc_3',
      text: 'How often did you have six or more drinks on one occasion in the past year?',
      options: [
        { value: 0, label: 'Never' },
        { value: 1, label: 'Less than monthly' },
        { value: 2, label: 'Monthly' },
        { value: 3, label: 'Weekly' },
        { value: 4, label: 'Daily or almost daily' },
      ],
    },
  ],
  scoring: (a) => sumIds(a, ['auditc_1','auditc_2','auditc_3']),
  bands: AUDITC_BANDS,
  severity: (s) => bandFor(s, AUDITC_BANDS),
}

// ---------------------------------------------------------------------------
// Registry + helpers
// ---------------------------------------------------------------------------

export const INSTRUMENTS: Instrument[] = [PHQ_9, GAD_7, PHQ_2, GAD_2, PCL_5, AUDIT_C]

export function getInstrument(id: string): Instrument | undefined {
  const normalized = id.toUpperCase().replace(/[^A-Z0-9-]/g, '')
  return INSTRUMENTS.find(
    (i) => i.id.toUpperCase() === normalized || i.id.replace('-', '').toUpperCase() === normalized,
  )
}

export function scoreAndEvaluate(
  instrumentId: string,
  answers: Record<string, number>,
): { score: number; severity: SeverityBand; alerts: Array<{ type: string; severity: string; message: string }> } {
  const inst = getInstrument(instrumentId)
  if (!inst) throw new Error(`Unknown instrument: ${instrumentId}`)
  const score = inst.scoring(answers)
  const severity = inst.severity(score)
  const alerts = (inst.alert_rules ?? [])
    .filter((r) => r.trigger(answers))
    .map((r) => ({ type: r.type, severity: r.severity, message: r.message }))
  return { score, severity, alerts }
}

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

function sumIds(a: Record<string, number>, ids: string[]): number {
  let s = 0
  for (const id of ids) s += a[id] ?? 0
  return s
}

function bandFor(score: number, bands: SeverityBand[]): SeverityBand {
  for (const b of bands) {
    if (score >= b.min && score <= b.max) return b
  }
  return bands[bands.length - 1]
}
