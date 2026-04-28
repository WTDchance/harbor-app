// app/api/ehr/treatment-plan-templates/seed-defaults/route.ts
//
// W43 T3 — seed a practice with a starter library of treatment plan
// templates covering the five most common diagnoses we see in
// outpatient psychotherapy:
//
//   F32.x   — Major depressive disorder, single episode
//   F41.1   — Generalized anxiety disorder
//   F43.10  — Post-traumatic stress disorder, unspecified
//   F90.0/.1 — ADHD (inattentive / combined)
//   F43.2   — Adjustment disorders
//
// The templates are intentionally generic — they're starter scaffolding
// the practice can edit, not "the right" treatment plan. Each goal
// includes a target_date placeholder string ("12 weeks") rather than a
// concrete date so the cloned plan picks up the patient's actual start
// date when filled in.
//
// Idempotent: skips templates whose `name` already exists for the
// practice. Safe to call repeatedly.

import { NextResponse } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type TemplateDef = {
  name: string
  description: string
  diagnoses: string[]
  presenting_problem: string
  frequency: string
  goals: Array<{
    text: string
    target_date_label: string
    objectives: Array<{ text: string; interventions: string[] }>
  }>
}

const DEFAULT_TEMPLATES: TemplateDef[] = [
  {
    name: 'Depression — CBT (starter)',
    description: 'Cognitive behavioral therapy for major depressive disorder.',
    diagnoses: ['F32.0', 'F32.1', 'F32.2', 'F33.0', 'F33.1', 'F33.2'],
    presenting_problem:
      'Patient reports persistent low mood, anhedonia, and impaired daily functioning.',
    frequency: 'Weekly individual therapy, 50 minutes',
    goals: [
      {
        text: 'Reduce depressive symptoms to mild or remitted range',
        target_date_label: '12 weeks',
        objectives: [
          {
            text: 'PHQ-9 ≤ 9 sustained across two consecutive sessions',
            interventions: [
              'Behavioral activation scheduling',
              'Cognitive restructuring of negative automatic thoughts',
              'Weekly PHQ-9 administration',
            ],
          },
        ],
      },
      {
        text: 'Restore engagement in valued activities',
        target_date_label: '8 weeks',
        objectives: [
          {
            text: 'Patient completes ≥3 valued activities per week',
            interventions: [
              'Activity monitoring + scheduling',
              'Pleasant events log',
              'Mastery + pleasure rating',
            ],
          },
        ],
      },
    ],
  },
  {
    name: 'Generalized anxiety — CBT (starter)',
    description: 'Cognitive behavioral therapy for generalized anxiety disorder.',
    diagnoses: ['F41.1'],
    presenting_problem:
      'Patient reports excessive, uncontrollable worry interfering with concentration, sleep, and relationships.',
    frequency: 'Weekly individual therapy, 50 minutes',
    goals: [
      {
        text: 'Reduce anxiety to mild or subclinical range',
        target_date_label: '12 weeks',
        objectives: [
          {
            text: 'GAD-7 ≤ 9 sustained across two consecutive sessions',
            interventions: [
              'Worry exposure and postponement',
              'Cognitive restructuring of catastrophic thinking',
              'Diaphragmatic breathing + progressive muscle relaxation',
            ],
          },
        ],
      },
      {
        text: 'Improve sleep quality',
        target_date_label: '8 weeks',
        objectives: [
          {
            text: 'Patient reports ≥6 hours uninterrupted sleep ≥4 nights/week',
            interventions: [
              'Sleep hygiene psychoeducation',
              'Stimulus control + sleep restriction protocol',
              'Pre-sleep relaxation routine',
            ],
          },
        ],
      },
    ],
  },
  {
    name: 'PTSD — Trauma-focused (starter)',
    description: 'Trauma-focused CBT or CPT for post-traumatic stress disorder.',
    diagnoses: ['F43.10', 'F43.11', 'F43.12'],
    presenting_problem:
      'Patient reports intrusive memories, avoidance, hyperarousal, and negative alterations in mood/cognition following a traumatic event.',
    frequency: 'Weekly individual therapy, 50–90 minutes',
    goals: [
      {
        text: 'Reduce PTSD symptoms to mild or subclinical range',
        target_date_label: '16 weeks',
        objectives: [
          {
            text: 'PCL-5 reduction of ≥10 points from baseline',
            interventions: [
              'Cognitive Processing Therapy (CPT) protocol',
              'Stuck-point identification and challenging',
              'Weekly PCL-5 administration',
            ],
          },
        ],
      },
      {
        text: 'Reduce avoidance and re-engage with previously avoided situations',
        target_date_label: '12 weeks',
        objectives: [
          {
            text: 'Patient completes ≥3 in-vivo exposures from hierarchy',
            interventions: [
              'In-vivo exposure hierarchy',
              'SUDS rating during and after exposures',
              'Coping-skill rehearsal',
            ],
          },
        ],
      },
    ],
  },
  {
    name: 'ADHD — Skills + behavioral (starter)',
    description: 'Behavioral and skills-based intervention for adult ADHD.',
    diagnoses: ['F90.0', 'F90.1', 'F90.2', 'F90.9'],
    presenting_problem:
      'Patient reports inattention, organizational difficulties, and/or hyperactivity-impulsivity impairing functioning across settings.',
    frequency: 'Weekly individual therapy, 50 minutes',
    goals: [
      {
        text: 'Improve organizational and time-management skills',
        target_date_label: '12 weeks',
        objectives: [
          {
            text: 'Patient consistently uses task list + calendar daily',
            interventions: [
              'Externalized planning systems (calendar, list, reminders)',
              'Task chunking + prioritization',
              'Implementation intentions for routine tasks',
            ],
          },
        ],
      },
      {
        text: 'Reduce procrastination and task-completion failures',
        target_date_label: '8 weeks',
        objectives: [
          {
            text: 'Patient completes ≥80% of weekly committed tasks',
            interventions: [
              'Behavioral activation for executive tasks',
              'Pomodoro / time-boxing',
              'Reinforcement scheduling for completion',
            ],
          },
        ],
      },
    ],
  },
  {
    name: 'Adjustment disorder — Brief intervention (starter)',
    description: 'Short-term supportive therapy for adjustment disorders.',
    diagnoses: ['F43.20', 'F43.21', 'F43.22', 'F43.23', 'F43.24', 'F43.25'],
    presenting_problem:
      'Patient presents with emotional or behavioral symptoms in response to an identifiable stressor occurring within the last 3 months.',
    frequency: 'Weekly individual therapy, 50 minutes',
    goals: [
      {
        text: 'Resolve symptoms related to the identifying stressor',
        target_date_label: '8 weeks',
        objectives: [
          {
            text: 'Patient reports symptom relief and adaptive coping with the stressor',
            interventions: [
              'Stressor reformulation + meaning-making',
              'Coping-skills training (problem-focused + emotion-focused)',
              'Social support mobilization',
            ],
          },
        ],
      },
      {
        text: 'Restore baseline functioning',
        target_date_label: '12 weeks',
        objectives: [
          {
            text: 'Patient resumes pre-stressor work, school, or social functioning',
            interventions: [
              'Graded return-to-activity plan',
              'Anticipatory problem-solving',
              'Relapse-prevention review',
            ],
          },
        ],
      },
    ],
  },
]

export async function POST() {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const created: string[] = []
  const skipped: string[] = []

  for (const t of DEFAULT_TEMPLATES) {
    const exists = await pool.query(
      `SELECT id FROM ehr_treatment_plan_templates
        WHERE practice_id = $1 AND name = $2 LIMIT 1`,
      [ctx.practiceId, t.name],
    )
    if (exists.rows.length > 0) {
      skipped.push(t.name)
      continue
    }

    // Convert TemplateDef goals to the JSONB shape ehr_treatment_plans uses.
    const goals = t.goals.map((g, gi) => ({
      id: `g${gi + 1}`,
      text: g.text,
      target_date: g.target_date_label,
      objectives: g.objectives.map((o, oi) => ({
        id: `g${gi + 1}-o${oi + 1}`,
        text: o.text,
        interventions: o.interventions,
      })),
    }))

    const ins = await pool.query(
      `INSERT INTO ehr_treatment_plan_templates
         (practice_id, name, description, diagnoses,
          presenting_problem, goals, frequency, created_by)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
       RETURNING id`,
      [
        ctx.practiceId,
        t.name,
        t.description,
        t.diagnoses,
        t.presenting_problem,
        JSON.stringify(goals),
        t.frequency,
        ctx.userId,
      ],
    )
    created.push(ins.rows[0].id)
  }

  await auditEhrAccess({
    ctx,
    action: 'treatment_plan_template.created',
    resourceType: 'ehr_treatment_plan_template',
    details: {
      kind: 'seed_defaults',
      created_count: created.length,
      skipped_count: skipped.length,
    },
  })

  return NextResponse.json({ created_count: created.length, skipped_count: skipped.length })
}
