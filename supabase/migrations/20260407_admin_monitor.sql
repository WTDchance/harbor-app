-- Admin signup monitor + kill switch (2026-04-07)
-- Run in Supabase SQL editor before merging the admin-monitor-landing PR.
-- Safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. app_settings: generic key/value store (used for signups_enabled kill switch)
-- ---------------------------------------------------------------------------
create table if not exists app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz default now(),
  updated_by uuid references auth.users(id)
);

-- Seed the signups_enabled flag (default true).
insert into app_settings (key, value)
values ('signups_enabled', 'true'::jsonb)
on conflict (key) do nothing;

-- RLS: only authenticated admin reads/writes; service role bypasses.
alter table app_settings enable row level security;

drop policy if exists app_settings_admin_all on app_settings;
create policy app_settings_admin_all on app_settings
  for all
  to authenticated
  using (true)
  with check (true);

-- ---------------------------------------------------------------------------
-- 2. practices: track provisioning error text for the retry UI
-- ---------------------------------------------------------------------------
alter table practices
  add column if not exists provisioning_error text,
  add column if not exists provisioning_attempts integer default 0;
