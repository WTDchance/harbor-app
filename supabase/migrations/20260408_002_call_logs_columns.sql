-- 20260408_002_call_logs_columns.sql
-- Adds the columns the intake auto-send pipeline and Twilio status callback
-- need on call_logs. All additive, all nullable, safe to re-run.

alter table public.call_logs
  add column if not exists intake_sent boolean default false,
  add column if not exists intake_delivery_preference text,
  add column if not exists intake_email text,
  add column if not exists twilio_call_sid text,
  add column if not exists first_event_at timestamptz,
  add column if not exists last_event_at timestamptz;

create index if not exists call_logs_twilio_sid_idx
  on public.call_logs (twilio_call_sid)
  where twilio_call_sid is not null;

create index if not exists call_logs_orphan_detection_idx
  on public.call_logs (practice_id, created_at desc, patient_id)
  where patient_id is null;
