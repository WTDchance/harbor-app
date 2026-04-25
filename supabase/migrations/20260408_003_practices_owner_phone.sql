-- 20260408_003_practices_owner_phone.sql
-- Adds owner_phone + owner_email + alert preferences to practices so the
-- reconciler knows where to send critical fail-safe alerts.

alter table public.practices
  add column if not exists owner_phone text,
  add column if not exists owner_email text,
  add column if not exists alert_sms_enabled boolean default true,
  add column if not exists alert_email_enabled boolean default true,
  add column if not exists daily_digest_enabled boolean default true;

-- Seed Hope and Harmony with Dr. Trace's cell as the default alert target.
-- (Safe even if the row doesn't exist â update is a no-op.)
update public.practices
set
  owner_phone = coalesce(owner_phone, '+15418920518'),
  alert_sms_enabled = coalesce(alert_sms_enabled, true)
where id = '9412f624-636b-46a0-954c-702be260d038';
