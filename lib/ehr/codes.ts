// lib/ehr/codes.ts
// Harbor EHR — CPT and ICD-10 code lists relevant to outpatient therapy.
//
// Kept as static data for now. These are the codes 95% of therapy
// practices actually use. If a therapist needs something exotic, they
// can still type it manually in the note's code field — the picker is
// a convenience, not a restriction.
//
// Sources: CMS public datasets (CPT procedure codes) + WHO ICD-10-CM
// (mental and behavioral disorders chapter, plus common Z codes).

export type Code = {
  code: string
  label: string
  /** Short searchable keywords: diagnoses / session types / common slang */
  keywords?: string
}

// ---------------------------------------------------------------------------
// CPT — outpatient behavioral health procedure codes
// ---------------------------------------------------------------------------

export const CPT_CODES: Code[] = [
  { code: '90791', label: 'Psychiatric diagnostic evaluation (intake, no medical)', keywords: 'intake evaluation initial first session' },
  { code: '90792', label: 'Psychiatric diagnostic evaluation with medical services', keywords: 'intake evaluation prescriber' },
  { code: '90832', label: 'Psychotherapy, 30 minutes', keywords: 'therapy brief short' },
  { code: '90834', label: 'Psychotherapy, 45 minutes', keywords: 'therapy standard session' },
  { code: '90837', label: 'Psychotherapy, 60 minutes', keywords: 'therapy extended hour' },
  { code: '90838', label: 'Psychotherapy, 60 min, add-on to E/M', keywords: 'therapy with em' },
  { code: '90846', label: 'Family psychotherapy, without patient present', keywords: 'family couples without' },
  { code: '90847', label: 'Family psychotherapy, with patient present', keywords: 'family couples with' },
  { code: '90853', label: 'Group psychotherapy', keywords: 'group' },
  { code: '90839', label: 'Psychotherapy for crisis, first 60 minutes', keywords: 'crisis emergency' },
  { code: '90840', label: 'Psychotherapy for crisis, each additional 30 min', keywords: 'crisis add-on' },
  { code: '90785', label: 'Interactive complexity add-on', keywords: 'interactive complexity addon' },
  { code: '96127', label: 'Brief emotional/behavioral assessment (PHQ/GAD)', keywords: 'phq gad assessment screening' },
  { code: '99354', label: 'Prolonged service, first 30-74 min add-on', keywords: 'prolonged extended' },
]

// ---------------------------------------------------------------------------
// ICD-10 — mental and behavioral disorders + common therapy Z-codes
// ---------------------------------------------------------------------------

export const ICD10_CODES: Code[] = [
  // Anxiety
  { code: 'F41.0', label: 'Panic disorder, without agoraphobia', keywords: 'panic attacks' },
  { code: 'F41.1', label: 'Generalized anxiety disorder', keywords: 'gad anxiety worry' },
  { code: 'F41.8', label: 'Other specified anxiety disorders', keywords: 'anxiety' },
  { code: 'F41.9', label: 'Anxiety disorder, unspecified', keywords: 'anxiety unspecified' },
  { code: 'F40.10', label: 'Social anxiety disorder (social phobia)', keywords: 'social phobia anxiety' },
  { code: 'F40.00', label: 'Agoraphobia, unspecified', keywords: 'agoraphobia' },

  // Depressive
  { code: 'F32.0', label: 'Major depressive disorder, single episode, mild', keywords: 'depression mild mdd' },
  { code: 'F32.1', label: 'Major depressive disorder, single episode, moderate', keywords: 'depression moderate mdd' },
  { code: 'F32.2', label: 'Major depressive disorder, single episode, severe w/o psychotic', keywords: 'depression severe mdd' },
  { code: 'F33.0', label: 'Major depressive disorder, recurrent, mild', keywords: 'depression recurrent' },
  { code: 'F33.1', label: 'Major depressive disorder, recurrent, moderate', keywords: 'depression recurrent' },
  { code: 'F33.2', label: 'Major depressive disorder, recurrent, severe', keywords: 'depression recurrent severe' },
  { code: 'F34.1', label: 'Persistent depressive disorder (dysthymia)', keywords: 'dysthymia chronic' },
  { code: 'F43.21', label: 'Adjustment disorder with depressed mood', keywords: 'adjustment depression' },
  { code: 'F43.22', label: 'Adjustment disorder with anxiety', keywords: 'adjustment anxiety' },
  { code: 'F43.23', label: 'Adjustment disorder with mixed anxiety and depressed mood', keywords: 'adjustment mixed' },

  // Trauma / stressor
  { code: 'F43.10', label: 'Post-traumatic stress disorder, unspecified', keywords: 'ptsd trauma' },
  { code: 'F43.11', label: 'Post-traumatic stress disorder, acute', keywords: 'ptsd trauma acute' },
  { code: 'F43.12', label: 'Post-traumatic stress disorder, chronic', keywords: 'ptsd trauma chronic' },
  { code: 'F43.0', label: 'Acute stress reaction', keywords: 'acute stress' },

  // OCD
  { code: 'F42.2', label: 'Mixed obsessional thoughts and acts', keywords: 'ocd obsessive' },
  { code: 'F42.9', label: 'Obsessive-compulsive disorder, unspecified', keywords: 'ocd obsessive unspecified' },

  // Bipolar
  { code: 'F31.9', label: 'Bipolar disorder, unspecified', keywords: 'bipolar' },
  { code: 'F31.81', label: 'Bipolar II disorder', keywords: 'bipolar 2 ii' },

  // ADHD
  { code: 'F90.0', label: 'ADHD, predominantly inattentive type', keywords: 'adhd attention inattentive' },
  { code: 'F90.1', label: 'ADHD, predominantly hyperactive type', keywords: 'adhd hyperactive' },
  { code: 'F90.2', label: 'ADHD, combined type', keywords: 'adhd combined' },
  { code: 'F90.9', label: 'ADHD, unspecified', keywords: 'adhd unspecified' },

  // Eating disorders
  { code: 'F50.00', label: 'Anorexia nervosa, unspecified', keywords: 'anorexia eating' },
  { code: 'F50.2', label: 'Bulimia nervosa', keywords: 'bulimia eating' },
  { code: 'F50.81', label: 'Binge eating disorder', keywords: 'binge eating bed' },

  // Substance (common)
  { code: 'F10.20', label: 'Alcohol dependence, uncomplicated', keywords: 'alcohol aud' },
  { code: 'F11.20', label: 'Opioid dependence, uncomplicated', keywords: 'opioid oud' },

  // Personality (common in therapy referrals)
  { code: 'F60.3', label: 'Borderline personality disorder', keywords: 'bpd borderline personality' },
  { code: 'F60.9', label: 'Personality disorder, unspecified', keywords: 'personality disorder' },

  // Neurodevelopmental
  { code: 'F84.0', label: 'Autism spectrum disorder', keywords: 'autism asd' },

  // Sleep
  { code: 'G47.00', label: 'Insomnia, unspecified', keywords: 'insomnia sleep' },

  // Z-codes (common in therapy — issues without full diagnosis)
  { code: 'Z63.0', label: 'Problems in relationship with spouse or partner', keywords: 'relationship marital partner spouse conflict' },
  { code: 'Z63.8', label: 'Other specified problems related to primary support group', keywords: 'family conflict' },
  { code: 'Z62.820', label: 'Parent-biological child conflict', keywords: 'parent child conflict' },
  { code: 'Z65.8', label: 'Other specified problems related to psychosocial circumstances', keywords: 'psychosocial' },
  { code: 'Z73.0', label: 'Burn-out', keywords: 'burnout work' },
  { code: 'Z73.3', label: 'Stress, not elsewhere classified', keywords: 'stress' },
  { code: 'Z71.9', label: 'Counseling, unspecified', keywords: 'counseling' },
]

// Search helper — matches against code AND label AND keywords, case-insensitive.
export function searchCodes(list: Code[], query: string, limit = 20): Code[] {
  const q = query.trim().toLowerCase()
  if (!q) return list.slice(0, limit)
  return list
    .filter((c) => {
      const hay = `${c.code} ${c.label} ${c.keywords ?? ''}`.toLowerCase()
      return hay.includes(q)
    })
    .slice(0, limit)
}
