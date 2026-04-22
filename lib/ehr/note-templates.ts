// lib/ehr/note-templates.ts
// Shorthand starter templates for common note types. Therapist picks one
// on the New Note page, fields pre-populate. Nothing hard-coded in DB —
// these are UI scaffolds only so a prompt like "session follow-up" becomes
// faster to document.

export type NoteTemplate = {
  id: string
  label: string
  description: string
  note_format: 'soap' | 'dap' | 'birp' | 'freeform'
  title_prefix: string
  subjective?: string
  objective?: string
  assessment?: string
  plan?: string
  body?: string
  suggested_cpt?: string[]
}

export const NOTE_TEMPLATES: NoteTemplate[] = [
  {
    id: 'individual_followup',
    label: 'Individual session (follow-up)',
    description: 'Standard 45-minute CBT/psychotherapy follow-up',
    note_format: 'soap',
    title_prefix: 'Session — ',
    subjective: 'Patient reported: ',
    objective: 'Patient appeared: ',
    assessment: 'Continued work on: ',
    plan: 'Next session: ',
    suggested_cpt: ['90834'],
  },
  {
    id: 'intake',
    label: 'Initial intake / diagnostic evaluation',
    description: 'First session — presenting concerns, history, provisional diagnosis',
    note_format: 'soap',
    title_prefix: 'Intake — ',
    subjective: 'Presenting concerns: \n\nHistory of presenting problem: \n\nRelevant psychiatric / medical history: \n\nSocial / family context: ',
    objective: 'Mental status: Patient was oriented x3, affect, mood, appearance, speech, thought process, insight, judgment.',
    assessment: 'Provisional impression: \n\nRisk: Denied suicidal/homicidal ideation; safety factors: ',
    plan: 'Recommended frequency: \nInitial goals: \nInformed consent reviewed: ',
    suggested_cpt: ['90791'],
  },
  {
    id: 'couples_session',
    label: 'Couples / family session',
    description: 'Two or more family members present',
    note_format: 'dap',
    title_prefix: 'Couples session — ',
    subjective: 'Presenting concerns (each member): ',
    objective: 'Interaction style observed: ',
    assessment: 'Key dynamics: ',
    plan: 'Homework / between-session tasks: ',
    suggested_cpt: ['90847'],
  },
  {
    id: 'medication_review',
    label: 'Medication management',
    description: 'Psychiatrist / psych NP visit for medication review',
    note_format: 'dap',
    title_prefix: 'Med review — ',
    subjective: 'Medication response: \nSide effects: \nAdherence: ',
    objective: 'Vitals / symptom scales: ',
    assessment: 'Clinical status: ',
    plan: 'Medication changes: \nFollow-up: ',
    suggested_cpt: ['90792'],
  },
  {
    id: 'crisis_contact',
    label: 'Crisis contact (phone or in-person)',
    description: 'Unscheduled contact due to acute distress',
    note_format: 'birp',
    title_prefix: 'Crisis contact — ',
    subjective: 'Precipitant: \nPresenting symptoms: ',
    objective: 'Intervention provided: Safety assessment; 988 Lifeline reviewed; coping strategies activated.',
    assessment: 'Patient response: ',
    plan: 'Safety plan reviewed/updated. Follow-up scheduled.',
    suggested_cpt: ['90839'],
  },
  {
    id: 'freeform',
    label: 'Freeform narrative',
    description: 'Unstructured — for brief contacts, chart reviews, staff communications',
    note_format: 'freeform',
    title_prefix: '',
    body: '',
  },
]
