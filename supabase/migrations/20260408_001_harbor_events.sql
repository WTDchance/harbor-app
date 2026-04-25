-- 20260408_001_harbor_events.sql
-- Creates the Harbor event spine: an append-only log of every meaningful
-- thing that happens in the system. Powers fail-safe detection, the
-- /dashboard/health surface, and KPI rollups.
--
-- Safe to run multiple times (idempotent via IF NOT EXISTS).

create table if not exists public.harbor_events (
  id              uuid primary key default gen_random_uuid(),
  practice_id     uuid not null references public.practices(id) on delete cascade,
  event_type      text not null,
  severity        text not null check (severity in ('info','warn','error','critical')),
  source          text not null,
  call_log_id     uuid references public.call_logs(id) on delete set null,
  patient_id      uuid references public.patients(id) on delete set null,
  intake_token_id uuid references public.intake_tokens(id) on delete set null,
  message         text,
  payload         jsonb not null default '{}'::jsonb,
  error_detail    text,
  created_at      timestamptz not null default now(),
  resolved_at     timestamptz,
  resolved_by     uuid references public.users(id) on delete set null
);

create index if not exists harbor_events_practice_created_idx
  on public.harbor_events (practice_id, created_at desc);

create index if not exists harbor_events_unresolved_idx
  on public.harbor_events (practice_id, severity, resolved_at)
  where severity in ('warn','error','critical');

create index if not exists harbor_events_type_idx
  on public.harbor_events (event_type, created_at desc);

-- Dedupe index: the reconciler stamps payload.dedupe_key for checks that
-- should only fire once per logical incident. We let info events duplicate
-- freely (they're cheap) but warn/error/critical must be unique by key.
create unique index if not exists harbor_events_dedupe_idx
  on public.harbor_events (practice_id, event_type, (payload->>'dedupe_key'))
  where (payload ? 'dedupe_key') and severity in ('warn','error','critical');

alter table public.harbor_events enable row level security;

-- Practice-scoped read access
drop policy if exists harbor_events_practice_read on public.harbor_events;
create policy harbor_events_practice_read on public.harbor_events
  for select using (
    practice_id = (select practice_id from public.users where id = auth.uid())
  );

-- Practice-scoped update (for "mark resolved")
drop policy if exists harbor_events_practice_update on public.harbor_events;
create policy harbor_events_practice_update on public.harbor_events
  for update using (
    practice_id = (select practice_id from public.users where id = auth.uid())
  );

-- No INSERT/DELETE policy: all writes go through supabaseAdmin (service role),
-- which bypasses RLS. Clients cannot insert events directly.

comment on table public.harbor_events is
  'Append-only event log for fail-safe detection, alerting, and KPI rollups. Writes only via service role.';
