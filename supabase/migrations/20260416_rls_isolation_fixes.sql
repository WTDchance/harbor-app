-- ==========================================================================
-- RLS isolation fixes (2026-04-16)
--
-- Addresses two classes of gaps found during the pre-launch signup audit:
--
-- 1. The helper function get_current_user_practice_id() relied on a JWT
--    claim (app_metadata.practice_id) that was never set during signup.
--    Fix: query the users table instead (matches the pattern newer
--    migrations already use).
--
-- 2. Five tables created in earlier migrations had no RLS at all:
--    patient_arrivals, outcome_assessments, appointment_reminders,
--    practice_members, onboarding_submissions.
--    Fix: enable RLS + add standard practice-scoped policies.
--
-- Safe to re-run: all statements are idempotent (CREATE OR REPLACE,
-- IF NOT EXISTS, DROP POLICY IF EXISTS before re-create).
-- ==========================================================================

-- ---------------------------------------------------------------------------
-- 1. Fix the helper function so ALL base-schema policies work correctly
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_current_user_practice_id()
RETURNS UUID AS $$
BEGIN
  RETURN (SELECT practice_id FROM public.users WHERE id = auth.uid());
END;
$$ LANGUAGE plpgsql STABLE;

-- ---------------------------------------------------------------------------
-- 2. Enable RLS on tables that were missing it
-- ---------------------------------------------------------------------------
ALTER TABLE IF EXISTS patient_arrivals ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS outcome_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS appointment_reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS practice_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS onboarding_submissions ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 3. Add standard practice-scoped policies for the newly-protected tables
-- ---------------------------------------------------------------------------

-- patient_arrivals
DROP POLICY IF EXISTS "practice_read_patient_arrivals" ON patient_arrivals;
CREATE POLICY "practice_read_patient_arrivals"
  ON patient_arrivals FOR SELECT
  USING (practice_id = get_current_user_practice_id());

DROP POLICY IF EXISTS "practice_insert_patient_arrivals" ON patient_arrivals;
CREATE POLICY "practice_insert_patient_arrivals"
  ON patient_arrivals FOR INSERT
  WITH CHECK (practice_id = get_current_user_practice_id());

DROP POLICY IF EXISTS "practice_update_patient_arrivals" ON patient_arrivals;
CREATE POLICY "practice_update_patient_arrivals"
  ON patient_arrivals FOR UPDATE
  USING (practice_id = get_current_user_practice_id());

-- outcome_assessments
DROP POLICY IF EXISTS "practice_read_outcome_assessments" ON outcome_assessments;
CREATE POLICY "practice_read_outcome_assessments"
  ON outcome_assessments FOR SELECT
  USING (practice_id = get_current_user_practice_id());

DROP POLICY IF EXISTS "practice_insert_outcome_assessments" ON outcome_assessments;
CREATE POLICY "practice_insert_outcome_assessments"
  ON outcome_assessments FOR INSERT
  WITH CHECK (practice_id = get_current_user_practice_id());

DROP POLICY IF EXISTS "practice_update_outcome_assessments" ON outcome_assessments;
CREATE POLICY "practice_update_outcome_assessments"
  ON outcome_assessments FOR UPDATE
  USING (practice_id = get_current_user_practice_id());

-- appointment_reminders
DROP POLICY IF EXISTS "practice_read_appointment_reminders" ON appointment_reminders;
CREATE POLICY "practice_read_appointment_reminders"
  ON appointment_reminders FOR SELECT
  USING (practice_id = get_current_user_practice_id());

DROP POLICY IF EXISTS "practice_insert_appointment_reminders" ON appointment_reminders;
CREATE POLICY "practice_insert_appointment_reminders"
  ON appointment_reminders FOR INSERT
  WITH CHECK (practice_id = get_current_user_practice_id());

DROP POLICY IF EXISTS "practice_update_appointment_reminders" ON appointment_reminders;
CREATE POLICY "practice_update_appointment_reminders"
  ON appointment_reminders FOR UPDATE
  USING (practice_id = get_current_user_practice_id());

-- practice_members
DROP POLICY IF EXISTS "practice_read_practice_members" ON practice_members;
CREATE POLICY "practice_read_practice_members"
  ON practice_members FOR SELECT
  USING (practice_id = get_current_user_practice_id());

DROP POLICY IF EXISTS "practice_insert_practice_members" ON practice_members;
CREATE POLICY "practice_insert_practice_members"
  ON practice_members FOR INSERT
  WITH CHECK (practice_id = get_current_user_practice_id());

DROP POLICY IF EXISTS "practice_update_practice_members" ON practice_members;
CREATE POLICY "practice_update_practice_members"
  ON practice_members FOR UPDATE
  USING (practice_id = get_current_user_practice_id());

-- onboarding_submissions
DROP POLICY IF EXISTS "practice_read_onboarding_submissions" ON onboarding_submissions;
CREATE POLICY "practice_read_onboarding_submissions"
  ON onboarding_submissions FOR SELECT
  USING (practice_id = get_current_user_practice_id());

DROP POLICY IF EXISTS "practice_insert_onboarding_submissions" ON onboarding_submissions;
CREATE POLICY "practice_insert_onboarding_submissions"
  ON onboarding_submissions FOR INSERT
  WITH CHECK (practice_id = get_current_user_practice_id());

-- ---------------------------------------------------------------------------
-- 4. Tighten overly permissive INSERT policies on service-role-only tables.
--    These tables are always written by supabaseAdmin (which bypasses RLS),
--    so the INSERT check should be restrictive for the anon/authenticated
--    key just in case.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Service role can insert call logs" ON call_logs;
CREATE POLICY "Service role can insert call logs"
  ON call_logs FOR INSERT
  WITH CHECK (practice_id = get_current_user_practice_id());

DROP POLICY IF EXISTS "Service role can insert sms conversations" ON sms_conversations;
CREATE POLICY "Service role can insert sms conversations"
  ON sms_conversations FOR INSERT
  WITH CHECK (practice_id = get_current_user_practice_id());
