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
  /** Optional follow-up rendered when this question is answered Yes (value === 1).
   *  The follow-up answer is stored alongside the answers map under `followup_id`. */
  followup?: {
    /** Stored under this key in the answers / responses_json map. */
    id: string
    /** Prompt shown to the patient. */
    text: string
    /** Render hint for the portal UI. */
    input_type: 'date' | 'text'
    /** Show the follow-up only when the parent question's value matches. */
    show_when: number
  }
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
// AUDIT (full 10-item Alcohol Use Disorders Identification Test)
//   Saunders et al. (1993). WHO-published, public domain.
//   Items 1-8 scored 0-4. Items 9-10 scored 0/2/4.
//   Bands: 0-7 low risk, 8-15 hazardous, 16-19 harmful, 20-40 likely dependence.
// ---------------------------------------------------------------------------
const AUDIT_FREQ_OPTIONS: ResponseOption[] = [
  { value: 0, label: 'Never' },
  { value: 1, label: 'Less than monthly' },
  { value: 2, label: 'Monthly' },
  { value: 3, label: 'Weekly' },
  { value: 4, label: 'Daily or almost daily' },
]
const AUDIT_INJURY_OPTIONS: ResponseOption[] = [
  { value: 0, label: 'No' },
  { value: 2, label: 'Yes, but not in the last year' },
  { value: 4, label: 'Yes, during the last year' },
]
const AUDIT_BANDS: SeverityBand[] = [
  { min: 0,  max: 7,  label: 'Low risk',                 color: 'green' },
  { min: 8,  max: 15, label: 'Hazardous use',            color: 'amber' },
  { min: 16, max: 19, label: 'Harmful use',              color: 'orange' },
  { min: 20, max: 40, label: 'Likely alcohol dependence', color: 'red' },
]

export const AUDIT: Instrument = {
  id: 'AUDIT',
  name: 'AUDIT — Alcohol Use Disorders Identification Test',
  description:
    'WHO-developed 10-item screen for hazardous and harmful alcohol use. Score 0–40.',
  max_score: 40,
  estimated_minutes: 3,
  instructions:
    'Please answer the following questions about your use of alcoholic beverages during the past year. Your answers will be kept confidential.',
  questions: [
    {
      id: 'audit_1',
      text: 'How often do you have a drink containing alcohol?',
      options: [
        { value: 0, label: 'Never' },
        { value: 1, label: 'Monthly or less' },
        { value: 2, label: '2 to 4 times a month' },
        { value: 3, label: '2 to 3 times a week' },
        { value: 4, label: '4 or more times a week' },
      ],
    },
    {
      id: 'audit_2',
      text: 'How many drinks containing alcohol do you have on a typical day when you are drinking?',
      options: [
        { value: 0, label: '1 or 2' },
        { value: 1, label: '3 or 4' },
        { value: 2, label: '5 or 6' },
        { value: 3, label: '7, 8, or 9' },
        { value: 4, label: '10 or more' },
      ],
    },
    { id: 'audit_3',  text: 'How often do you have six or more drinks on one occasion?', options: AUDIT_FREQ_OPTIONS },
    { id: 'audit_4',  text: 'How often during the last year have you found that you were not able to stop drinking once you had started?', options: AUDIT_FREQ_OPTIONS },
    { id: 'audit_5',  text: 'How often during the last year have you failed to do what was normally expected of you because of drinking?', options: AUDIT_FREQ_OPTIONS },
    { id: 'audit_6',  text: 'How often during the last year have you needed a first drink in the morning to get yourself going after a heavy drinking session?', options: AUDIT_FREQ_OPTIONS },
    { id: 'audit_7',  text: 'How often during the last year have you had a feeling of guilt or remorse after drinking?', options: AUDIT_FREQ_OPTIONS },
    { id: 'audit_8',  text: 'How often during the last year have you been unable to remember what happened the night before because you had been drinking?', options: AUDIT_FREQ_OPTIONS },
    { id: 'audit_9',  text: 'Have you or someone else been injured as a result of your drinking?', options: AUDIT_INJURY_OPTIONS },
    { id: 'audit_10', text: 'Has a relative, friend, doctor, or other health worker been concerned about your drinking or suggested you cut down?', options: AUDIT_INJURY_OPTIONS },
  ],
  scoring: (a) => {
    let s = 0
    for (let i = 1; i <= 10; i++) s += a[`audit_${i}`] ?? 0
    return s
  },
  bands: AUDIT_BANDS,
  severity: (s) => bandFor(s, AUDIT_BANDS),
}

// ---------------------------------------------------------------------------
// DAST-10 (Drug Abuse Screening Test, Skinner 1982)
//   10 yes/no items. Item 3 is reverse-scored (No = 1).
//   Bands: 0 none, 1-2 low, 3-5 moderate, 6-8 substantial, 9-10 severe.
// ---------------------------------------------------------------------------
const YES_NO_OPTIONS: ResponseOption[] = [
  { value: 0, label: 'No' },
  { value: 1, label: 'Yes' },
]
const DAST10_BANDS: SeverityBand[] = [
  { min: 0,  max: 0,  label: 'No problems reported',   color: 'green' },
  { min: 1,  max: 2,  label: 'Low level',              color: 'amber' },
  { min: 3,  max: 5,  label: 'Moderate level',         color: 'orange' },
  { min: 6,  max: 8,  label: 'Substantial level',      color: 'orange' },
  { min: 9,  max: 10, label: 'Severe level',           color: 'red' },
]

export const DAST_10: Instrument = {
  id: 'DAST-10',
  name: 'DAST-10 — Drug Abuse Screening Test',
  description:
    '10-item screen for drug-use problems in the past 12 months. Excludes alcohol and tobacco.',
  max_score: 10,
  estimated_minutes: 2,
  instructions:
    'The following questions concern information about your possible involvement with drugs, not including alcoholic beverages, during the past 12 months. "Drug abuse" refers to (1) the use of prescribed or over-the-counter drugs in excess of the directions and (2) any non-medical use of drugs. Please answer every question.',
  questions: [
    { id: 'dast_1',  text: 'Have you used drugs other than those required for medical reasons?', options: YES_NO_OPTIONS },
    { id: 'dast_2',  text: 'Do you abuse more than one drug at a time?', options: YES_NO_OPTIONS },
    { id: 'dast_3',  text: 'Are you always able to stop using drugs when you want to?', options: YES_NO_OPTIONS },
    { id: 'dast_4',  text: 'Have you had "blackouts" or "flashbacks" as a result of drug use?', options: YES_NO_OPTIONS },
    { id: 'dast_5',  text: 'Do you ever feel bad or guilty about your drug use?', options: YES_NO_OPTIONS },
    { id: 'dast_6',  text: 'Does your spouse (or parents) ever complain about your involvement with drugs?', options: YES_NO_OPTIONS },
    { id: 'dast_7',  text: 'Have you neglected your family because of your use of drugs?', options: YES_NO_OPTIONS },
    { id: 'dast_8',  text: 'Have you engaged in illegal activities in order to obtain drugs?', options: YES_NO_OPTIONS },
    { id: 'dast_9',  text: 'Have you ever experienced withdrawal symptoms (felt sick) when you stopped taking drugs?', options: YES_NO_OPTIONS },
    { id: 'dast_10', text: 'Have you had medical problems as a result of your drug use (e.g., memory loss, hepatitis, convulsions, bleeding)?', options: YES_NO_OPTIONS },
  ],
  scoring: (a) => {
    // Items 1, 2, 4-10: Yes = 1 point. Item 3: No = 1 point (reverse).
    let s = 0
    for (const i of [1, 2, 4, 5, 6, 7, 8, 9, 10]) s += a[`dast_${i}`] === 1 ? 1 : 0
    s += a['dast_3'] === 0 ? 1 : 0
    return s
  },
  bands: DAST10_BANDS,
  severity: (s) => bandFor(s, DAST10_BANDS),
}

// ---------------------------------------------------------------------------
// NICHQ Vanderbilt Assessment Scale — Parent Informant
//   47 symptom items + 8 performance items. ADHD subscales:
//     Inattentive (1-9): >=6 items rated 2 or 3 = positive screen.
//     Hyperactive/Impulsive (10-18): >=6 items rated 2 or 3 = positive screen.
//   Comorbid screens: ODD (19-26), Conduct (27-40), Anxiety/Depression (41-47).
// ---------------------------------------------------------------------------
const VANDERBILT_FREQ: ResponseOption[] = [
  { value: 0, label: 'Never' },
  { value: 1, label: 'Occasionally' },
  { value: 2, label: 'Often' },
  { value: 3, label: 'Very Often' },
]
const VANDERBILT_PERF: ResponseOption[] = [
  { value: 1, label: 'Excellent' },
  { value: 2, label: 'Above Average' },
  { value: 3, label: 'Average' },
  { value: 4, label: 'Somewhat of a Problem' },
  { value: 5, label: 'Problematic' },
]
// Severity for the parent form is a simple total of the 47 frequency items
// (max 141). Bands here are descriptive only — clinical interpretation uses
// the per-subscale "count of items >=2" thresholds defined above.
const VAND_PARENT_BANDS: SeverityBand[] = [
  { min: 0,   max: 24,  label: 'Below screening concern',           color: 'green' },
  { min: 25,  max: 49,  label: 'Mild — review subscale thresholds', color: 'amber' },
  { min: 50,  max: 89,  label: 'Moderate — likely positive screen', color: 'orange' },
  { min: 90,  max: 141, label: 'Severe — likely positive screen',   color: 'red' },
]

export const VANDERBILT_PARENT: Instrument = {
  id: 'VANDERBILT-PARENT',
  name: 'NICHQ Vanderbilt — Parent Informant',
  description:
    'Parent-completed ADHD rating scale with comorbid ODD, conduct, anxiety/depression, and performance items. For ages 6–12.',
  max_score: 141,
  estimated_minutes: 10,
  instructions:
    'Each rating should be considered in the context of what is appropriate for the age of your child. When completing this form, please think about your child\'s behaviors in the past 6 months.',
  questions: [
    // Inattentive 1-9
    { id: 'vp_1',  text: 'Does not pay attention to details or makes careless mistakes, for example in homework', options: VANDERBILT_FREQ },
    { id: 'vp_2',  text: 'Has difficulty keeping attention to what needs to be done', options: VANDERBILT_FREQ },
    { id: 'vp_3',  text: 'Does not seem to listen when spoken to directly', options: VANDERBILT_FREQ },
    { id: 'vp_4',  text: 'Does not follow through when given directions and fails to finish activities (not due to refusal or failure to understand)', options: VANDERBILT_FREQ },
    { id: 'vp_5',  text: 'Has difficulty organizing tasks and activities', options: VANDERBILT_FREQ },
    { id: 'vp_6',  text: 'Avoids, dislikes, or does not want to start tasks that require ongoing mental effort', options: VANDERBILT_FREQ },
    { id: 'vp_7',  text: 'Loses things necessary for tasks or activities (toys, assignments, pencils, or books)', options: VANDERBILT_FREQ },
    { id: 'vp_8',  text: 'Is easily distracted by noises or other stimuli', options: VANDERBILT_FREQ },
    { id: 'vp_9',  text: 'Is forgetful in daily activities', options: VANDERBILT_FREQ },
    // Hyperactive/Impulsive 10-18
    { id: 'vp_10', text: 'Fidgets with hands or feet or squirms in seat', options: VANDERBILT_FREQ },
    { id: 'vp_11', text: 'Leaves seat in classroom or in other situations in which remaining seated is expected', options: VANDERBILT_FREQ },
    { id: 'vp_12', text: 'Runs about or climbs too much when remaining seated is expected', options: VANDERBILT_FREQ },
    { id: 'vp_13', text: 'Has difficulty playing or beginning quiet play activities', options: VANDERBILT_FREQ },
    { id: 'vp_14', text: 'Is "on the go" or often acts as if "driven by a motor"', options: VANDERBILT_FREQ },
    { id: 'vp_15', text: 'Talks too much', options: VANDERBILT_FREQ },
    { id: 'vp_16', text: 'Blurts out answers before questions have been completed', options: VANDERBILT_FREQ },
    { id: 'vp_17', text: 'Has difficulty waiting his or her turn', options: VANDERBILT_FREQ },
    { id: 'vp_18', text: 'Interrupts or intrudes in on others\' conversations and/or activities', options: VANDERBILT_FREQ },
    // ODD 19-26
    { id: 'vp_19', text: 'Argues with adults', options: VANDERBILT_FREQ },
    { id: 'vp_20', text: 'Loses temper', options: VANDERBILT_FREQ },
    { id: 'vp_21', text: 'Actively defies or refuses to go along with adults\' requests or rules', options: VANDERBILT_FREQ },
    { id: 'vp_22', text: 'Deliberately annoys people', options: VANDERBILT_FREQ },
    { id: 'vp_23', text: 'Blames others for his or her mistakes or misbehaviors', options: VANDERBILT_FREQ },
    { id: 'vp_24', text: 'Is touchy or easily annoyed by others', options: VANDERBILT_FREQ },
    { id: 'vp_25', text: 'Is angry or resentful', options: VANDERBILT_FREQ },
    { id: 'vp_26', text: 'Is spiteful and wants to get even', options: VANDERBILT_FREQ },
    // Conduct 27-40
    { id: 'vp_27', text: 'Bullies, threatens, or intimidates others', options: VANDERBILT_FREQ },
    { id: 'vp_28', text: 'Starts physical fights', options: VANDERBILT_FREQ },
    { id: 'vp_29', text: 'Lies to get out of trouble or to avoid obligations (i.e., "cons" others)', options: VANDERBILT_FREQ },
    { id: 'vp_30', text: 'Is truant from school (skips school) without permission', options: VANDERBILT_FREQ },
    { id: 'vp_31', text: 'Is physically cruel to people', options: VANDERBILT_FREQ },
    { id: 'vp_32', text: 'Has stolen things that have value', options: VANDERBILT_FREQ },
    { id: 'vp_33', text: 'Deliberately destroys others\' property', options: VANDERBILT_FREQ },
    { id: 'vp_34', text: 'Has used a weapon that can cause serious harm (bat, knife, brick, gun)', options: VANDERBILT_FREQ },
    { id: 'vp_35', text: 'Is physically cruel to animals', options: VANDERBILT_FREQ },
    { id: 'vp_36', text: 'Has deliberately set fires to cause damage', options: VANDERBILT_FREQ },
    { id: 'vp_37', text: 'Has broken into someone else\'s home, business, or car', options: VANDERBILT_FREQ },
    { id: 'vp_38', text: 'Has stayed out at night without permission', options: VANDERBILT_FREQ },
    { id: 'vp_39', text: 'Has run away from home overnight', options: VANDERBILT_FREQ },
    { id: 'vp_40', text: 'Has forced someone into sexual activity', options: VANDERBILT_FREQ },
    // Anxiety/Depression 41-47
    { id: 'vp_41', text: 'Is fearful, anxious, or worried', options: VANDERBILT_FREQ },
    { id: 'vp_42', text: 'Is afraid to try new things for fear of making mistakes', options: VANDERBILT_FREQ },
    { id: 'vp_43', text: 'Feels worthless or inferior', options: VANDERBILT_FREQ },
    { id: 'vp_44', text: 'Blames self for problems, feels guilty', options: VANDERBILT_FREQ },
    { id: 'vp_45', text: 'Feels lonely, unwanted, or unloved; complains that "no one loves him or her"', options: VANDERBILT_FREQ },
    { id: 'vp_46', text: 'Is sad, unhappy, or depressed', options: VANDERBILT_FREQ },
    { id: 'vp_47', text: 'Is self-conscious or easily embarrassed', options: VANDERBILT_FREQ },
    // Performance 48-55 (different scale; 1-3 acceptable, 4-5 problem)
    { id: 'vp_48', text: 'Overall school performance', options: VANDERBILT_PERF },
    { id: 'vp_49', text: 'Reading', options: VANDERBILT_PERF },
    { id: 'vp_50', text: 'Writing', options: VANDERBILT_PERF },
    { id: 'vp_51', text: 'Mathematics', options: VANDERBILT_PERF },
    { id: 'vp_52', text: 'Relationship with parents', options: VANDERBILT_PERF },
    { id: 'vp_53', text: 'Relationship with siblings', options: VANDERBILT_PERF },
    { id: 'vp_54', text: 'Relationship with peers', options: VANDERBILT_PERF },
    { id: 'vp_55', text: 'Participation in organized activities (e.g., teams)', options: VANDERBILT_PERF },
  ],
  scoring: (a) => {
    // Total of the 47 frequency items only (performance has a different scale).
    let s = 0
    for (let i = 1; i <= 47; i++) s += a[`vp_${i}`] ?? 0
    return s
  },
  bands: VAND_PARENT_BANDS,
  severity: (s) => bandFor(s, VAND_PARENT_BANDS),
  alert_rules: [
    {
      type: 'adhd_inattentive_screen',
      severity: 'warn',
      trigger: (a) => {
        let n = 0
        for (let i = 1; i <= 9; i++) if ((a[`vp_${i}`] ?? 0) >= 2) n++
        return n >= 6
      },
      message: 'Positive screen for ADHD inattentive presentation (≥6/9 items rated Often or Very Often).',
    },
    {
      type: 'adhd_hyperactive_screen',
      severity: 'warn',
      trigger: (a) => {
        let n = 0
        for (let i = 10; i <= 18; i++) if ((a[`vp_${i}`] ?? 0) >= 2) n++
        return n >= 6
      },
      message: 'Positive screen for ADHD hyperactive/impulsive presentation (≥6/9 items rated Often or Very Often).',
    },
  ],
}

// ---------------------------------------------------------------------------
// NICHQ Vanderbilt Assessment Scale — Teacher Informant
//   35 symptom items + 8 performance items. Subscales:
//     Inattentive (1-9), Hyperactive/Impulsive (10-18),
//     ODD/Conduct (19-28), Anxiety/Depression (29-35).
// ---------------------------------------------------------------------------
const VAND_TEACHER_BANDS: SeverityBand[] = [
  { min: 0,  max: 17,  label: 'Below screening concern',           color: 'green' },
  { min: 18, max: 39,  label: 'Mild — review subscale thresholds', color: 'amber' },
  { min: 40, max: 69,  label: 'Moderate — likely positive screen', color: 'orange' },
  { min: 70, max: 105, label: 'Severe — likely positive screen',   color: 'red' },
]

export const VANDERBILT_TEACHER: Instrument = {
  id: 'VANDERBILT-TEACHER',
  name: 'NICHQ Vanderbilt — Teacher Informant',
  description:
    'Teacher-completed ADHD rating scale with comorbid ODD/conduct and anxiety/depression items. For ages 6–12.',
  max_score: 105,
  estimated_minutes: 10,
  instructions:
    'Each rating should be considered in the context of what is appropriate for the age of the child you are rating and should reflect that child\'s behavior since the beginning of the school year.',
  questions: [
    // Inattentive 1-9
    { id: 'vt_1',  text: 'Fails to give attention to details or makes careless mistakes in schoolwork', options: VANDERBILT_FREQ },
    { id: 'vt_2',  text: 'Has difficulty sustaining attention to tasks or activities', options: VANDERBILT_FREQ },
    { id: 'vt_3',  text: 'Does not seem to listen when spoken to directly', options: VANDERBILT_FREQ },
    { id: 'vt_4',  text: 'Does not follow through on instructions and fails to finish schoolwork (not due to oppositional behavior or failure to understand)', options: VANDERBILT_FREQ },
    { id: 'vt_5',  text: 'Has difficulty organizing tasks and activities', options: VANDERBILT_FREQ },
    { id: 'vt_6',  text: 'Avoids, dislikes, or is reluctant to engage in tasks that require sustained mental effort', options: VANDERBILT_FREQ },
    { id: 'vt_7',  text: 'Loses things necessary for tasks or activities (school assignments, pencils, or books)', options: VANDERBILT_FREQ },
    { id: 'vt_8',  text: 'Is easily distracted by extraneous stimuli', options: VANDERBILT_FREQ },
    { id: 'vt_9',  text: 'Is forgetful in daily activities', options: VANDERBILT_FREQ },
    // Hyperactive/Impulsive 10-18
    { id: 'vt_10', text: 'Fidgets with hands or feet or squirms in seat', options: VANDERBILT_FREQ },
    { id: 'vt_11', text: 'Leaves seat in classroom or in other situations in which remaining seated is expected', options: VANDERBILT_FREQ },
    { id: 'vt_12', text: 'Runs about or climbs excessively in situations in which remaining seated is expected', options: VANDERBILT_FREQ },
    { id: 'vt_13', text: 'Has difficulty playing or engaging in leisure activities quietly', options: VANDERBILT_FREQ },
    { id: 'vt_14', text: 'Is "on the go" or often acts as if "driven by a motor"', options: VANDERBILT_FREQ },
    { id: 'vt_15', text: 'Talks excessively', options: VANDERBILT_FREQ },
    { id: 'vt_16', text: 'Blurts out answers before questions have been completed', options: VANDERBILT_FREQ },
    { id: 'vt_17', text: 'Has difficulty waiting in line', options: VANDERBILT_FREQ },
    { id: 'vt_18', text: 'Interrupts or intrudes on others (e.g., butts into conversations/games)', options: VANDERBILT_FREQ },
    // ODD/Conduct 19-28
    { id: 'vt_19', text: 'Loses temper', options: VANDERBILT_FREQ },
    { id: 'vt_20', text: 'Actively defies or refuses to comply with adult\'s requests or rules', options: VANDERBILT_FREQ },
    { id: 'vt_21', text: 'Is angry or resentful', options: VANDERBILT_FREQ },
    { id: 'vt_22', text: 'Is spiteful and vindictive', options: VANDERBILT_FREQ },
    { id: 'vt_23', text: 'Bullies, threatens, or intimidates others', options: VANDERBILT_FREQ },
    { id: 'vt_24', text: 'Initiates physical fights', options: VANDERBILT_FREQ },
    { id: 'vt_25', text: 'Lies to obtain goods for favors or to avoid obligations (e.g., "cons" others)', options: VANDERBILT_FREQ },
    { id: 'vt_26', text: 'Is physically cruel to people', options: VANDERBILT_FREQ },
    { id: 'vt_27', text: 'Has stolen items of nontrivial value', options: VANDERBILT_FREQ },
    { id: 'vt_28', text: 'Deliberately destroys others\' property', options: VANDERBILT_FREQ },
    // Anxiety/Depression 29-35
    { id: 'vt_29', text: 'Is fearful, anxious, or worried', options: VANDERBILT_FREQ },
    { id: 'vt_30', text: 'Is self-conscious or easily embarrassed', options: VANDERBILT_FREQ },
    { id: 'vt_31', text: 'Is afraid to try new things for fear of making mistakes', options: VANDERBILT_FREQ },
    { id: 'vt_32', text: 'Feels worthless or inferior', options: VANDERBILT_FREQ },
    { id: 'vt_33', text: 'Blames self for problems; feels guilty', options: VANDERBILT_FREQ },
    { id: 'vt_34', text: 'Feels lonely, unwanted, or unloved; complains that "no one loves him or her"', options: VANDERBILT_FREQ },
    { id: 'vt_35', text: 'Is sad, unhappy, or depressed', options: VANDERBILT_FREQ },
    // Performance 36-43
    { id: 'vt_36', text: 'Reading', options: VANDERBILT_PERF },
    { id: 'vt_37', text: 'Mathematics', options: VANDERBILT_PERF },
    { id: 'vt_38', text: 'Written expression', options: VANDERBILT_PERF },
    { id: 'vt_39', text: 'Relationship with peers', options: VANDERBILT_PERF },
    { id: 'vt_40', text: 'Following directions', options: VANDERBILT_PERF },
    { id: 'vt_41', text: 'Disrupting class', options: VANDERBILT_PERF },
    { id: 'vt_42', text: 'Assignment completion', options: VANDERBILT_PERF },
    { id: 'vt_43', text: 'Organizational skills', options: VANDERBILT_PERF },
  ],
  scoring: (a) => {
    let s = 0
    for (let i = 1; i <= 35; i++) s += a[`vt_${i}`] ?? 0
    return s
  },
  bands: VAND_TEACHER_BANDS,
  severity: (s) => bandFor(s, VAND_TEACHER_BANDS),
  alert_rules: [
    {
      type: 'adhd_inattentive_screen',
      severity: 'warn',
      trigger: (a) => {
        let n = 0
        for (let i = 1; i <= 9; i++) if ((a[`vt_${i}`] ?? 0) >= 2) n++
        return n >= 6
      },
      message: 'Positive teacher screen for ADHD inattentive presentation (≥6/9 items rated Often or Very Often).',
    },
    {
      type: 'adhd_hyperactive_screen',
      severity: 'warn',
      trigger: (a) => {
        let n = 0
        for (let i = 10; i <= 18; i++) if ((a[`vt_${i}`] ?? 0) >= 2) n++
        return n >= 6
      },
      message: 'Positive teacher screen for ADHD hyperactive/impulsive presentation (≥6/9 items rated Often or Very Often).',
    },
  ],
}


// ---------------------------------------------------------------------------
// CSSRS — Columbia Suicide Severity Rating Scale, Self-Report
//   Lifetime / Recent, ages 12+. Posner et al., Columbia University.
//   Six yes/no items. Q6 has a follow-up date field ("How long ago...").
//   Severity is the HIGHEST-severity Yes (1..6), not a sum:
//     Q1 yes → 1 Wish to be dead
//     Q2 yes → 2 Non-specific active suicidal thoughts
//     Q3 yes → 3 Active suicidal ideation with method
//     Q4 yes → 4 Active suicidal ideation with intent
//     Q5 yes → 5 Active suicidal ideation with plan and intent (HIGH RISK)
//     Q6 yes within last 3 months → 6 Suicidal behavior — recent (CRITICAL)
//     Q6 yes outside last 3 months → still 6, but flagged historical.
//   Severity ≥ 5 OR Q6-recent must set patients.risk_level = 'high' and
//   trigger a crisis alert in addition to the normal completion flow.
// ---------------------------------------------------------------------------

/** Optional companion key written into responses_json when Q6 is yes:
 *  the date the most recent attempt/preparatory behavior occurred (ISO date).
 *  The portal UI converts that date to a 0/1 "recent" flag stored under
 *  `cssrs_6_recent` (1 = within last 3 months, 0 = older) so the pure
 *  scoring function below can stay numeric. */
const CSSRS_BANDS: SeverityBand[] = [
  { min: 0, max: 0, label: 'No suicidal ideation or behavior reported', color: 'green' },
  { min: 1, max: 1, label: 'Wish to be dead',                          color: 'amber' },
  { min: 2, max: 2, label: 'Non-specific active suicidal thoughts',    color: 'amber' },
  { min: 3, max: 3, label: 'Active suicidal ideation with method',     color: 'orange' },
  { min: 4, max: 4, label: 'Active suicidal ideation with intent',     color: 'orange' },
  { min: 5, max: 5, label: 'Active suicidal ideation with plan and intent', color: 'red' },
  { min: 6, max: 6, label: 'Suicidal behavior',                        color: 'red' },
]

export const CSSRS: Instrument = {
  id: 'CSSRS',
  name: 'C-SSRS — Columbia Suicide Severity Rating Scale (Self-Report)',
  description:
    'Columbia Suicide Severity Rating Scale — Self-Report, Lifetime/Recent. Six yes/no items measuring the spectrum of suicidal ideation and behavior. Ages 12+.',
  max_score: 6,
  estimated_minutes: 3,
  instructions:
    'The following questions ask about thoughts of suicide and behaviors. Please answer each question honestly — your answers help us keep you safe. If you answered Yes to question 6, please also tell us how long ago.',
  questions: [
    {
      id: 'cssrs_1',
      text: 'Have you wished you were dead or wished you could go to sleep and not wake up?',
      options: YES_NO_OPTIONS,
    },
    {
      id: 'cssrs_2',
      text: 'Have you actually had any thoughts of killing yourself?',
      options: YES_NO_OPTIONS,
    },
    {
      id: 'cssrs_3',
      text: 'Have you been thinking about how you might do this?',
      options: YES_NO_OPTIONS,
    },
    {
      id: 'cssrs_4',
      text: 'Have you had these thoughts and had some intention of acting on them?',
      options: YES_NO_OPTIONS,
    },
    {
      id: 'cssrs_5',
      text: 'Have you started to work out or worked out the details of how to kill yourself? Do you intend to carry out this plan?',
      options: YES_NO_OPTIONS,
    },
    {
      id: 'cssrs_6',
      text: 'Have you ever done anything, started to do anything, or prepared to do anything to end your life? Examples: Collected pills, obtained a gun, gave away valuables, wrote a will or suicide note, took out pills but didn\'t swallow any, held a gun but changed your mind or it was grabbed from your hand, went to the roof but didn\'t jump; or actually took pills, tried to shoot yourself, cut yourself, tried to hang yourself, etc.',
      options: YES_NO_OPTIONS,
      followup: {
        id: 'cssrs_6_when',
        text: 'How long ago did you do any of these?',
        input_type: 'date',
        show_when: 1,
      },
    },
  ],
  // Highest-severity Yes wins. Q6-recent (within last 3 months) is encoded
  // by the portal as cssrs_6_recent = 1 so this stays a pure numeric fn.
  scoring: (a) => {
    let highest = 0
    if ((a.cssrs_1 ?? 0) === 1) highest = Math.max(highest, 1)
    if ((a.cssrs_2 ?? 0) === 1) highest = Math.max(highest, 2)
    if ((a.cssrs_3 ?? 0) === 1) highest = Math.max(highest, 3)
    if ((a.cssrs_4 ?? 0) === 1) highest = Math.max(highest, 4)
    if ((a.cssrs_5 ?? 0) === 1) highest = Math.max(highest, 5)
    if ((a.cssrs_6 ?? 0) === 1) highest = Math.max(highest, 6)
    return highest
  },
  bands: CSSRS_BANDS,
  severity: (s) => bandFor(s, CSSRS_BANDS),
  alert_rules: [
    {
      type: 'suicidal_ideation',
      severity: 'error',
      // Any Yes to Q2..Q5 endorses active ideation — escalate to therapist.
      trigger: (a) =>
        (a.cssrs_2 ?? 0) === 1 ||
        (a.cssrs_3 ?? 0) === 1 ||
        (a.cssrs_4 ?? 0) === 1 ||
        (a.cssrs_5 ?? 0) === 1,
      message:
        'C-SSRS: active suicidal ideation endorsed. Clinical review required within 24 hours.',
    },
    {
      type: 'suicidal_plan_intent',
      severity: 'error',
      // Q5 = ideation with plan AND intent. High risk by published rubric.
      trigger: (a) => (a.cssrs_5 ?? 0) === 1,
      message:
        'C-SSRS Q5 endorsed: active suicidal ideation with plan and intent. High risk — initiate safety plan now.',
    },
    {
      type: 'suicidal_behavior_recent',
      severity: 'error',
      // Q6 yes within the last 3 months (encoded by portal as cssrs_6_recent=1).
      trigger: (a) =>
        (a.cssrs_6 ?? 0) === 1 && (a.cssrs_6_recent ?? 0) === 1,
      message:
        'C-SSRS Q6 endorsed within last 3 months: recent suicidal behavior. CRITICAL — assess for immediate safety, consider 988 / ED referral.',
    },
    {
      type: 'suicidal_behavior_lifetime',
      severity: 'warn',
      trigger: (a) =>
        (a.cssrs_6 ?? 0) === 1 && (a.cssrs_6_recent ?? 0) !== 1,
      message:
        'C-SSRS Q6 endorsed (historical, not within last 3 months): prior suicidal behavior on record.',
    },
  ],
}

// ---------------------------------------------------------------------------
// Registry + helpers
// ---------------------------------------------------------------------------

export const INSTRUMENTS: Instrument[] = [PHQ_9, GAD_7, PHQ_2, GAD_2, PCL_5, AUDIT_C, AUDIT, DAST_10, VANDERBILT_PARENT, VANDERBILT_TEACHER, CSSRS]

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
