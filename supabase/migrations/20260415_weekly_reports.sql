-- 20260415_weekly_reports.sql
-- Weekly ROI report: per-practice email sent Monday mornings.
-- Safe to re-run (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).

-- ---------------------------------------------------------------
-- practices: columns controlling the report
-- ---------------------------------------------------------------
alter table public.practices
  add column if not exists avg_session_fee numeric(10,2) default 150.00,
  add column if not exists answered_call_conversion_rate numeric(4,3) default 0.35,
  add column if not exists weekly_report_enabled boolean default false,
  add column if not exists weekly_report_email text;

comment on column public.practices.avg_session_fee is
  'Used by the weekly ROI report to estimate revenue. Default $150.';
comment on column public.practices.answered_call_conversion_rate is
  'Fraction of answered callers that become booked patients. Default 0.35.';
comment on column public.practices.weekly_report_enabled is
  'If true, practice receives the Monday morning ROI email.';
comment on column public.practices.weekly_report_email is
  'Override recipient for weekly report. Falls back to billing_email / owner email.';

-- ---------------------------------------------------------------
-- weekly_reports: one row per practice per week, audit of what was sent
-- ---------------------------------------------------------------
create table if not exists public.weekly_reports (
    id                        uuid primary key default gen_random_uuid(),
    practice_id               uuid not null references public.practices(id) on delete cascade,
    week_start                date not null,  -- Monday (UTC) of the reported week
  week_end                  date not null,  -- Sunday (UTC)
  answered_calls            integer not null default 0,
    booked_appointments       integer not null default 0,
    filled_cancellations      integer not null default 0,
    new_patients              integer not null default 0,
    estimated_pipeline_value  numeric(10,2) not null default 0,
    estimated_booked_revenue  numeric(10,2) not null default 0,
    estimated_filled_revenue  numeric(10,2) not null default 0,
    recipient_email           text,
    sent_at                   timestamptz,
    error                     text,
    created_at                timestamptz not null default now(),
    unique (practice_id, week_start)
  );

create index if not exists weekly_reports_practice_idx
  on public.weekly_reports (practice_id, week_start desc);

-- RLS
alter table public.weekly_reports enable row level security;

drop policy if exists "weekly_reports practice read" on public.weekly_reports;
create policy "weekly_reports practice read" on public.weekly_reports
  for select using (
      practice_id = (select practice_id from public.users where id = auth.uid())
    );
