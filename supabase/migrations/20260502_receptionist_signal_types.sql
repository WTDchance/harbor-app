-- Wave 52 / D5 — extend the ehr_call_signals signal_type CHECK with new
-- behavioral kinds. ALTER TABLE ... ADD CONSTRAINT after dropping the
-- old one preserves existing rows (none of the new kinds are mandatory).

ALTER TABLE public.ehr_call_signals
  DROP CONSTRAINT IF EXISTS ehr_call_signals_signal_type_check;

ALTER TABLE public.ehr_call_signals
  ADD CONSTRAINT ehr_call_signals_signal_type_check CHECK (signal_type IN (
    -- W50 originals
    'intent', 'hesitation',
    'urgency_low', 'urgency_medium', 'urgency_high',
    'crisis_flag',
    'name_candidate', 'dob_candidate', 'phone_confirmation',
    'insurance_mention',
    'scheduling_intent', 'scheduling_friction',
    'sentiment_positive', 'sentiment_negative',
    'dropout_signal', 'payment_concern',
    -- W52 D5 quantification kinds
    'assessment_administered_in_call',
    'consent_signature_initiated',
    'consent_signature_completed',
    'appointment_booked_in_call',
    'appointment_declined_in_call',
    'caller_interrupted_receptionist',
    'caller_corrected_receptionist',
    'caller_payment_method_disclosed',
    'caller_returning_vs_new',
    'caller_referral_source'
  ));
