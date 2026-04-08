# Harbor Fail-Safes & Health Monitoring â PR package

This folder contains the full `feat/failsafes-and-metrics` PR contents as a flat set of files mirroring the target paths in the Harbor repo. Everything is designed to be additive â no existing file is touched, no migration is destructive, and the PR is safe to open as a draft and merge when you're ready.

## What's in this PR

**Goal:** make Harbor watch itself. Every inbound call, every patient extraction, every intake link, every crisis detection flows through a single event spine. A cron reconciler catches anything that *should* have happened but didn't, and loud red banners appear on `/dashboard/health` so the practice owner sees it. Critical failures also text the owner's phone.

### Files

| Path in repo | Purpose |
|---|---|
| `supabase/migrations/20260408_001_harbor_events.sql` | New `harbor_events` table + indexes + RLS |
| `supabase/migrations/20260408_002_call_logs_columns.sql` | Adds `intake_sent`, `twilio_call_sid`, timing cols to `call_logs` |
| `supabase/migrations/20260408_003_practices_owner_phone.sql` | Adds `owner_phone`, `owner_email`, alert toggles; seeds Hope & Harmony with Dr. Trace's cell |
| `lib/events.ts` | `logEvent()` helper â never throws |
| `app/api/twilio/status/route.ts` | Twilio status-callback endpoint (independent source of truth for inbound calls) |
| `app/api/cron/reconcile/route.ts` | The reconciler: orphan patients, missing end-of-call, stuck intakes, failed crisis alerts, owner SMS/email alerts |
| `app/dashboard/health/page.tsx` | Practice-owner health inbox |
| `app/dashboard/health/resolve-button.tsx` | Client "mark resolved" button |

### What's deliberately NOT in this PR

- No edits to `app/api/vapi/webhook/route.ts`. The file is 1,148 lines and editing it via the GitHub browser UI is error-prone. The reconciler detects 80% of problems post-hoc by reading `call_logs` directly, which is enough to start building trust. Follow-up PR will add inline `logEvent()` calls to the webhook.
- No metrics materialized view, admin portfolio page, or investor PDF export. Those become follow-up PRs once the event spine has a week of real data to aggregate.
- No daily digest email. Follow-up PR.

## Deployment steps (in order)

### 1. Run the migrations in Supabase

Open https://supabase.com/dashboard/project/oubmpjtbbobiuzumagec/sql/new and run each file in order:

1. `20260408_001_harbor_events.sql`
2. `20260408_002_call_logs_columns.sql`
3. `20260408_003_practices_owner_phone.sql`

All three are idempotent â safe to re-run.

### 2. Add the Railway env var

On the harbor-app Railway service, add:
```
RECONCILER_SECRET=<generate a long random string>
```
(Any value is fine â it's just a shared secret between the cron scheduler and the reconciler endpoint.)

### 3. Configure the Twilio status callback

In Twilio Console â Phone Numbers â +1 (541) 539-4890 â edit the number:
- **"Call status changes"** field â set to `https://harborreceptionist.com/api/twilio/status` (HTTP POST)
- Leave the **"A call comes in"** field unchanged (must still point to `https://api.vapi.ai/twilio/inbound_call`)
- Check the status events you want Twilio to POST: `initiated`, `ringing`, `answered`, `completed`

### 4. Wire up the Railway cron

In Railway â harbor-app service â Cron Jobs (or a one-off cron service), add:
```
Schedule:  */5 * * * *
Command:   curl -s -H "x-cron-secret: $RECONCILER_SECRET" https://harborreceptionist.com/api/cron/reconcile
```

Or equivalently as a scheduled HTTP ping from any cron provider.

### 5. Verify

1. Make a test call to +1 541-539-4890.
2. Watch `harbor_events` in the Supabase table editor â you should see at least one `call.twilio_inbound` row within seconds.
3. Visit `https://harborreceptionist.com/dashboard/health` â should show ð¢ "All clear".
4. Manually hit the reconciler: `curl -H "x-cron-secret: $RECONCILER_SECRET" https://harborreceptionist.com/api/cron/reconcile` â should return `{ ok: true, counts: { ... } }`.

## Rollback

All migrations are additive. To roll back:
1. Drop the Twilio status callback URL in the Twilio console.
2. Disable the Railway cron.
3. (Optional) `drop table public.harbor_events;` â all other additions are nullable columns and can stay.

No production data is at risk.

## Follow-up PRs

1. **Webhook instrumentation** â add `logEvent()` calls inline to `app/api/vapi/webhook/route.ts` so we get events in real time instead of via the reconciler lag.
2. **Metrics rollup** â `harbor_metrics_daily` materialized view + `/admin/metrics` portfolio page.
3. **Daily digest email** â 8am summary to practice owners.
4. **Investor PDF export** â one-click snapshot of portfolio KPIs for pitch decks.
5. **Main dashboard health pill + KPI tiles** â surface the top-line numbers on the home dashboard.
