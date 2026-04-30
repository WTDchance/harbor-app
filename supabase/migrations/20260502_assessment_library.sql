-- Wave 52 / D2 — validated assessment library + practice config + admin runs.
--
-- Distinct from the legacy ehr_assessment_schedules (W42) which was a
-- per-patient schedule of arbitrary instruments. This is a canonical
-- catalog with seed data + administration tracking that powers
-- in-call PHQ-2 / GAD-2 and portal PHQ-9 / GAD-7 / CSSRS / PCL-5 / AUDIT-C.

CREATE TABLE IF NOT EXISTS public.assessment_definitions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug               TEXT UNIQUE NOT NULL,
  name               TEXT NOT NULL,
  short_description  TEXT,
  question_count     INT NOT NULL,
  questions          JSONB NOT NULL,
  scoring_rules      JSONB NOT NULL,
  estimated_minutes  INT NOT NULL,
  call_administrable BOOLEAN NOT NULL DEFAULT FALSE,
  scope              TEXT NOT NULL CHECK (scope IN ('depression','anxiety','suicidality','ptsd','substance','general')),
  source_citation    TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.assessment_administrations (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id        UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,
  patient_id         UUID REFERENCES public.patients(id) ON DELETE SET NULL,
  lead_id            UUID REFERENCES public.reception_leads(id) ON DELETE SET NULL,

  assessment_slug    TEXT NOT NULL REFERENCES public.assessment_definitions(slug) ON DELETE RESTRICT,
  administered_via   TEXT NOT NULL CHECK (administered_via IN ('receptionist_call','portal','therapist_session','sms_link')),

  call_id            UUID REFERENCES public.call_logs(id) ON DELETE SET NULL,
  appointment_id     UUID REFERENCES public.appointments(id) ON DELETE SET NULL,
  portal_token       TEXT UNIQUE,

  status             TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','in_progress','completed','expired','abandoned')),

  responses          JSONB NOT NULL DEFAULT '[]'::jsonb,
  raw_score          INT,
  computed_score     JSONB,
  crisis_flagged     BOOLEAN NOT NULL DEFAULT FALSE,

  started_at         TIMESTAMPTZ,
  completed_at       TIMESTAMPTZ,
  expires_at         TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),

  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assessment_administrations_patient_recent
  ON public.assessment_administrations (practice_id, patient_id, completed_at DESC NULLS LAST)
  WHERE patient_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_assessment_administrations_status
  ON public.assessment_administrations (practice_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_assessment_administrations_crisis
  ON public.assessment_administrations (practice_id, completed_at DESC)
  WHERE crisis_flagged = TRUE;

CREATE OR REPLACE FUNCTION public.assessment_administrations_touch()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_assessment_administrations_updated_at ON public.assessment_administrations;
CREATE TRIGGER trg_assessment_administrations_updated_at
  BEFORE UPDATE ON public.assessment_administrations
  FOR EACH ROW EXECUTE FUNCTION public.assessment_administrations_touch();

ALTER TABLE public.assessment_administrations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS assessment_administrations_all ON public.assessment_administrations;
CREATE POLICY assessment_administrations_all ON public.assessment_administrations
  FOR ALL TO authenticated
  USING      (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));


CREATE TABLE IF NOT EXISTS public.practice_assessment_config (
  practice_id                       UUID PRIMARY KEY REFERENCES public.practices(id) ON DELETE CASCADE,
  intake_assessments                TEXT[] NOT NULL DEFAULT '{}',
  call_administered_assessments     TEXT[] NOT NULL DEFAULT ARRAY['phq-2','gad-2']::text[],
  recurring_assessments             JSONB NOT NULL DEFAULT '[]'::jsonb,
  crisis_routing                    TEXT NOT NULL DEFAULT 'flag_and_alert',
  updated_at                        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION public.practice_assessment_config_touch()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_practice_assessment_config_updated_at ON public.practice_assessment_config;
CREATE TRIGGER trg_practice_assessment_config_updated_at
  BEFORE UPDATE ON public.practice_assessment_config
  FOR EACH ROW EXECUTE FUNCTION public.practice_assessment_config_touch();

ALTER TABLE public.practice_assessment_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS practice_assessment_config_all ON public.practice_assessment_config;
CREATE POLICY practice_assessment_config_all ON public.practice_assessment_config
  FOR ALL TO authenticated
  USING      (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

-- ───────────────────────────────────────────────────────────────────
-- Seed: 7 validated instruments. Citations map to the public-domain
-- versions of each (PHQ-9 Kroenke/Spitzer/Williams 2001; GAD-7 Spitzer
-- 2006; CSSRS Posner 2008; PCL-5 Weathers 2013; AUDIT-C Bush 1998).
-- ───────────────────────────────────────────────────────────────────

INSERT INTO public.assessment_definitions (slug, name, short_description, question_count,
  questions, scoring_rules, estimated_minutes, call_administrable, scope, source_citation)
VALUES
('phq-2', 'PHQ-2', 'Two-item depression screener.', 2,
 '[{"id":"q1","text":"Over the last 2 weeks, how often have you been bothered by little interest or pleasure in doing things?","scale":"frequency_4"},{"id":"q2","text":"Over the last 2 weeks, how often have you been bothered by feeling down, depressed, or hopeless?","scale":"frequency_4"}]'::jsonb,
 '{"scale":"frequency_4","scale_values":{"Not at all":0,"Several days":1,"More than half the days":2,"Nearly every day":3},"sum_thresholds":[{"min":0,"max":2,"label":"negative"},{"min":3,"max":6,"label":"positive_screen"}],"escalate_on_positive":"phq-9"}'::jsonb,
 1, true, 'depression', 'Kroenke K, Spitzer RL, Williams JBW. Med Care. 2003;41:1284-92.')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.assessment_definitions (slug, name, short_description, question_count,
  questions, scoring_rules, estimated_minutes, call_administrable, scope, source_citation)
VALUES
('phq-9', 'PHQ-9', 'Nine-item depression severity measure.', 9,
 '[{"id":"q1","text":"Little interest or pleasure in doing things","scale":"frequency_4"},{"id":"q2","text":"Feeling down, depressed, or hopeless","scale":"frequency_4"},{"id":"q3","text":"Trouble falling or staying asleep, or sleeping too much","scale":"frequency_4"},{"id":"q4","text":"Feeling tired or having little energy","scale":"frequency_4"},{"id":"q5","text":"Poor appetite or overeating","scale":"frequency_4"},{"id":"q6","text":"Feeling bad about yourself — or that you are a failure or have let yourself or your family down","scale":"frequency_4"},{"id":"q7","text":"Trouble concentrating on things, such as reading the newspaper or watching television","scale":"frequency_4"},{"id":"q8","text":"Moving or speaking so slowly that other people could have noticed; or the opposite — being so fidgety or restless that you have been moving around a lot more than usual","scale":"frequency_4"},{"id":"q9","text":"Thoughts that you would be better off dead, or of hurting yourself in some way","scale":"frequency_4","crisis_question":true}]'::jsonb,
 '{"scale":"frequency_4","scale_values":{"Not at all":0,"Several days":1,"More than half the days":2,"Nearly every day":3},"sum_thresholds":[{"min":0,"max":4,"label":"minimal"},{"min":5,"max":9,"label":"mild"},{"min":10,"max":14,"label":"moderate"},{"min":15,"max":19,"label":"moderately_severe"},{"min":20,"max":27,"label":"severe"}],"crisis_triggers":[{"question_id":"q9","values":["Several days","More than half the days","Nearly every day"],"action":"flag_and_alert","escalate_to":"cssrs"}]}'::jsonb,
 5, false, 'depression', 'Kroenke K, Spitzer RL, Williams JBW. J Gen Intern Med. 2001;16(9):606-13.')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.assessment_definitions (slug, name, short_description, question_count,
  questions, scoring_rules, estimated_minutes, call_administrable, scope, source_citation)
VALUES
('gad-2', 'GAD-2', 'Two-item anxiety screener.', 2,
 '[{"id":"q1","text":"Feeling nervous, anxious, or on edge","scale":"frequency_4"},{"id":"q2","text":"Not being able to stop or control worrying","scale":"frequency_4"}]'::jsonb,
 '{"scale":"frequency_4","scale_values":{"Not at all":0,"Several days":1,"More than half the days":2,"Nearly every day":3},"sum_thresholds":[{"min":0,"max":2,"label":"negative"},{"min":3,"max":6,"label":"positive_screen"}],"escalate_on_positive":"gad-7"}'::jsonb,
 1, true, 'anxiety', 'Kroenke K, Spitzer RL, Williams JBW, Lowe B. Ann Intern Med. 2007;146:317-25.')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.assessment_definitions (slug, name, short_description, question_count,
  questions, scoring_rules, estimated_minutes, call_administrable, scope, source_citation)
VALUES
('gad-7', 'GAD-7', 'Seven-item generalized anxiety disorder scale.', 7,
 '[{"id":"q1","text":"Feeling nervous, anxious, or on edge","scale":"frequency_4"},{"id":"q2","text":"Not being able to stop or control worrying","scale":"frequency_4"},{"id":"q3","text":"Worrying too much about different things","scale":"frequency_4"},{"id":"q4","text":"Trouble relaxing","scale":"frequency_4"},{"id":"q5","text":"Being so restless that it is hard to sit still","scale":"frequency_4"},{"id":"q6","text":"Becoming easily annoyed or irritable","scale":"frequency_4"},{"id":"q7","text":"Feeling afraid as if something awful might happen","scale":"frequency_4"}]'::jsonb,
 '{"scale":"frequency_4","scale_values":{"Not at all":0,"Several days":1,"More than half the days":2,"Nearly every day":3},"sum_thresholds":[{"min":0,"max":4,"label":"minimal"},{"min":5,"max":9,"label":"mild"},{"min":10,"max":14,"label":"moderate"},{"min":15,"max":21,"label":"severe"}]}'::jsonb,
 4, false, 'anxiety', 'Spitzer RL, Kroenke K, Williams JBW, Lowe B. Arch Intern Med. 2006;166:1092-7.')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.assessment_definitions (slug, name, short_description, question_count,
  questions, scoring_rules, estimated_minutes, call_administrable, scope, source_citation)
VALUES
('cssrs', 'C-SSRS Screen', 'Columbia Suicide Severity Rating Scale — risk screen (6 items).', 6,
 '[{"id":"q1","text":"Have you wished you were dead or wished you could go to sleep and not wake up?","scale":"yes_no"},{"id":"q2","text":"Have you actually had any thoughts of killing yourself?","scale":"yes_no","crisis_question":true},{"id":"q3","text":"Have you been thinking about how you might do this?","scale":"yes_no","crisis_question":true},{"id":"q4","text":"Have you had these thoughts and had some intention of acting on them?","scale":"yes_no","crisis_question":true},{"id":"q5","text":"Have you started to work out or worked out the details of how to kill yourself? Do you intend to carry out this plan?","scale":"yes_no","crisis_question":true},{"id":"q6","text":"Have you ever done anything, started to do anything, or prepared to do anything to end your life?","scale":"yes_no","crisis_question":true}]'::jsonb,
 '{"scale":"yes_no","scale_values":{"Yes":1,"No":0},"crisis_triggers":[{"question_id":"q2","values":["Yes"],"action":"flag_and_alert"},{"question_id":"q3","values":["Yes"],"action":"flag_and_alert"},{"question_id":"q4","values":["Yes"],"action":"flag_and_alert","escalate_severity":"critical"},{"question_id":"q5","values":["Yes"],"action":"flag_and_alert","escalate_severity":"critical"},{"question_id":"q6","values":["Yes"],"action":"flag_and_alert","escalate_severity":"critical"}],"sum_thresholds":[{"min":0,"max":0,"label":"no_ideation"},{"min":1,"max":1,"label":"passive_ideation"},{"min":2,"max":3,"label":"active_ideation"},{"min":4,"max":6,"label":"high_risk"}]}'::jsonb,
 3, false, 'suicidality', 'Posner K, Brown GK, Stanley B, et al. Am J Psychiatry. 2011;168(12):1266-77.')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.assessment_definitions (slug, name, short_description, question_count,
  questions, scoring_rules, estimated_minutes, call_administrable, scope, source_citation)
VALUES
('pcl-5', 'PCL-5', 'PTSD Checklist for DSM-5 (20 items).', 20,
 '[{"id":"q1","text":"Repeated, disturbing, and unwanted memories of the stressful experience?","scale":"severity_5"},{"id":"q2","text":"Repeated, disturbing dreams of the stressful experience?","scale":"severity_5"},{"id":"q3","text":"Suddenly feeling or acting as if the stressful experience were actually happening again (as if you were actually back there reliving it)?","scale":"severity_5"},{"id":"q4","text":"Feeling very upset when something reminded you of the stressful experience?","scale":"severity_5"},{"id":"q5","text":"Having strong physical reactions when something reminded you of the stressful experience (for example, heart pounding, trouble breathing, sweating)?","scale":"severity_5"},{"id":"q6","text":"Avoiding memories, thoughts, or feelings related to the stressful experience?","scale":"severity_5"},{"id":"q7","text":"Avoiding external reminders of the stressful experience (for example, people, places, conversations, activities, objects, or situations)?","scale":"severity_5"},{"id":"q8","text":"Trouble remembering important parts of the stressful experience?","scale":"severity_5"},{"id":"q9","text":"Having strong negative beliefs about yourself, other people, or the world?","scale":"severity_5"},{"id":"q10","text":"Blaming yourself or someone else for the stressful experience or what happened after it?","scale":"severity_5"},{"id":"q11","text":"Having strong negative feelings such as fear, horror, anger, guilt, or shame?","scale":"severity_5"},{"id":"q12","text":"Loss of interest in activities that you used to enjoy?","scale":"severity_5"},{"id":"q13","text":"Feeling distant or cut off from other people?","scale":"severity_5"},{"id":"q14","text":"Trouble experiencing positive feelings (for example, being unable to feel happiness or have loving feelings for people close to you)?","scale":"severity_5"},{"id":"q15","text":"Irritable behavior, angry outbursts, or acting aggressively?","scale":"severity_5"},{"id":"q16","text":"Taking too many risks or doing things that could cause you harm?","scale":"severity_5"},{"id":"q17","text":"Being super-alert or watchful or on guard?","scale":"severity_5"},{"id":"q18","text":"Feeling jumpy or easily startled?","scale":"severity_5"},{"id":"q19","text":"Having difficulty concentrating?","scale":"severity_5"},{"id":"q20","text":"Trouble falling or staying asleep?","scale":"severity_5"}]'::jsonb,
 '{"scale":"severity_5","scale_values":{"Not at all":0,"A little bit":1,"Moderately":2,"Quite a bit":3,"Extremely":4},"sum_thresholds":[{"min":0,"max":32,"label":"sub_threshold"},{"min":33,"max":80,"label":"probable_ptsd"}]}'::jsonb,
 10, false, 'ptsd', 'Weathers FW, Litz BT, Keane TM, et al. National Center for PTSD. 2013.')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.assessment_definitions (slug, name, short_description, question_count,
  questions, scoring_rules, estimated_minutes, call_administrable, scope, source_citation)
VALUES
('audit-c', 'AUDIT-C', 'Three-item alcohol-use screen.', 3,
 '[{"id":"q1","text":"How often did you have a drink containing alcohol in the past year?","scale":"audit_c_q1"},{"id":"q2","text":"How many drinks containing alcohol did you have on a typical day when you were drinking in the past year?","scale":"audit_c_q2"},{"id":"q3","text":"How often did you have six or more drinks on one occasion in the past year?","scale":"audit_c_q3"}]'::jsonb,
 '{"sum_thresholds":[{"min":0,"max":2,"label":"negative_female_or_3_male","note":"3+ female or 4+ male is positive"},{"min":3,"max":12,"label":"positive_screen"}]}'::jsonb,
 2, false, 'substance', 'Bush K, Kivlahan DR, McDonell MB, Fihn SD, Bradley KA. Arch Intern Med. 1998;158(16):1789-95.')
ON CONFLICT (slug) DO NOTHING;
