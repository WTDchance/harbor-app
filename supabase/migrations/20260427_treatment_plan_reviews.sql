-- Wave 39 / Task 3 — Treatment plan reviews (90-day cycle).
--
-- Insurance audits and accreditation bodies expect documented review
-- of active treatment plans every 90 days. This migration adds:
--   1. ehr_treatment_plans.next_review_at — when the next review is
--      due. Backfilled from created_at + 90 days for active plans.
--   2. ehr_treatment_plan_reviews — one row per review event, with
--      goal-status snapshot (per-goal status) and cosign hooks.

-- 1. Extend the parent.
ALTER TABLE public.ehr_treatment_plans
  ADD COLUMN IF NOT EXISTS next_review_at DATE;

-- Backfill: for active plans without a review_date, default to
-- created_at + 90 days. Plans that have a review_date already use that.
UPDATE public.ehr_treatment_plans
   SET next_review_at = COALESCE(review_date, (created_at::date + INTERVAL '90 days')::date)
 WHERE status = 'active'
   AND next_review_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ehr_plans_next_review_due
  ON public.ehr_treatment_plans (practice_id, next_review_at)
  WHERE status = 'active' AND next_review_at IS NOT NULL;

-- 2. Reviews table.
CREATE TABLE IF NOT EXISTS public.ehr_treatment_plan_reviews (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  treatment_plan_id  UUID NOT NULL REFERENCES public.ehr_treatment_plans(id) ON DELETE CASCADE,
  patient_id         UUID NOT NULL REFERENCES public.patients(id)            ON DELETE CASCADE,
  practice_id        UUID NOT NULL REFERENCES public.practices(id)           ON DELETE CASCADE,
  reviewed_by        UUID NOT NULL REFERENCES public.users(id)               ON DELETE RESTRICT,
  reviewed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  review_outcome     TEXT NOT NULL
                       CHECK (review_outcome IN (
                         'continue_unchanged',
                         'continue_with_modifications',
                         'discharge',
                         'transfer'
                       )),
  progress_notes     TEXT NOT NULL,

  -- goal_status: { goal_id (string) -> 'not_started'|'in_progress'|'met'|'no_longer_relevant' }
  -- Free-form JSONB so it tolerates schema drift on ehr_treatment_plans.goals.
  goal_status        JSONB NOT NULL DEFAULT '{}'::JSONB,
  modifications      TEXT,
  next_review_at     DATE NOT NULL,

  cosign_required    BOOLEAN NOT NULL DEFAULT FALSE,
  cosigned_at        TIMESTAMPTZ,
  cosigned_by        UUID REFERENCES public.users(id) ON DELETE SET NULL,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tp_reviews_plan
  ON public.ehr_treatment_plan_reviews (treatment_plan_id, reviewed_at DESC);
CREATE INDEX IF NOT EXISTS idx_tp_reviews_practice_pending_cosign
  ON public.ehr_treatment_plan_reviews (practice_id, cosigned_at)
  WHERE cosign_required = TRUE AND cosigned_at IS NULL;

ALTER TABLE public.ehr_treatment_plan_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tp_reviews_select ON public.ehr_treatment_plan_reviews;
CREATE POLICY tp_reviews_select ON public.ehr_treatment_plan_reviews
  FOR SELECT TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS tp_reviews_insert ON public.ehr_treatment_plan_reviews;
CREATE POLICY tp_reviews_insert ON public.ehr_treatment_plan_reviews
  FOR INSERT TO authenticated
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS tp_reviews_update ON public.ehr_treatment_plan_reviews;
CREATE POLICY tp_reviews_update ON public.ehr_treatment_plan_reviews
  FOR UPDATE TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));
