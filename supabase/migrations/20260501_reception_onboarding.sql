-- W51 D5 — reception onboarding state.

CREATE TABLE IF NOT EXISTS public.practice_reception_onboarding (
  practice_id          UUID PRIMARY KEY REFERENCES public.practices(id) ON DELETE CASCADE,

  step_calendar_done   TIMESTAMPTZ,    -- step 1
  step_greeting_done   TIMESTAMPTZ,    -- step 2
  step_phone_done      TIMESTAMPTZ,    -- step 3
  step_test_call_done  TIMESTAMPTZ,    -- step 4

  is_live              BOOLEAN GENERATED ALWAYS AS (
    step_calendar_done IS NOT NULL
    AND step_greeting_done IS NOT NULL
    AND step_phone_done IS NOT NULL
    AND step_test_call_done IS NOT NULL
  ) STORED,

  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION public.practice_reception_onboarding_touch()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_practice_reception_onboarding_updated_at ON public.practice_reception_onboarding;
CREATE TRIGGER trg_practice_reception_onboarding_updated_at
  BEFORE UPDATE ON public.practice_reception_onboarding
  FOR EACH ROW EXECUTE FUNCTION public.practice_reception_onboarding_touch();

ALTER TABLE public.practice_reception_onboarding ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS practice_reception_onboarding_all ON public.practice_reception_onboarding;
CREATE POLICY practice_reception_onboarding_all ON public.practice_reception_onboarding
  FOR ALL TO authenticated
  USING      (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));
