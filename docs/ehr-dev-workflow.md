# EHR-v0 — Local Dev Workflow

The EHR module is built on branch `feature/ehr-v0` against a **separate dev Supabase project (DB #2)** so prod is never touched until the single big-bang merge. This doc is the runbook for any laptop working on this branch.

See also: [ehr-branch-setup.md](./ehr-branch-setup.md) for conventions (folders, table prefixes, design system, reintegration checklist).

---

## TL;DR

```bash
git fetch origin
git checkout feature/ehr-v0
npm install
# paste .env.ehr (see below) into repo root
npm run dev:ehr
# open http://localhost:3000 and log in as ehr-dev@harbor.local / HarborEhrDev1!
```

---

## What's isolated from prod

| Surface | Prod | Dev |
|---|---|---|
| Git branch | `main` (auto-deploys via Railway) | `feature/ehr-v0` (never auto-deploys) |
| Supabase project | `oubmpjtbbobiuzumagec` (harbor-app prod) | `badelywhoacuccztxhjh` (harbor-ehr-dev) |
| Next.js env | `.env.local` | `.env.ehr` |
| App URL | harborreceptionist.com | http://localhost:3000 |
| Test practice | "Hope & Harmony" etc. | "EHR Dev Test Practice" (`00000000-…-ED01`) |

Nothing in the EHR dev workflow touches prod data, prod Railway, or prod Supabase. The **only** time anything moves to prod is at the merge to `main`, and that's just schema migrations applied by hand.

---

## Initial setup (first time on any laptop)

1. Clone/update the repo and check out the branch:
   ```bash
   git clone https://github.com/WTDchance/harbor-app.git
   cd harbor-app
   git fetch origin
   git checkout feature/ehr-v0
   npm install
   ```

2. Get `.env.ehr` contents from Chance (never commit this file — it's gitignored). Paste into `harbor-app/.env.ehr`.

3. Verify the dev DB has the bootstrap applied:
   ```bash
   npm run ehr:inspect
   ```
   You should see ~32 tables including `practices`, `patients`, `appointments`, `users`, `therapists`, `audit_logs`. If the list is empty or short, run:
   ```bash
   npm run ehr:bootstrap    # applies schema + migrations to DB #2
   npm run ehr:seed         # creates test practice + test user
   ```

4. Run the dev server:
   ```bash
   npm run dev:ehr
   ```
   Open http://localhost:3000 and log in with:
   - **Email:** `ehr-dev@harbor.local`
   - **Password:** `HarborEhrDev1!`

---

## Everyday commands

| Command | What it does |
|---|---|
| `npm run dev:ehr` | Next.js dev server using `.env.ehr` (points at DB #2) |
| `npm run dev` | Next.js dev server using `.env.local` (points at **prod** — don't use for EHR work) |
| `npm run ehr:inspect` | Print which tables exist in DB #2 |
| `npm run ehr:bootstrap` | Apply all existing Harbor migrations to DB #2 (idempotent) |
| `npm run ehr:seed` | Re-seed test practice + test user (idempotent) |

---

## Known schema gap (read this before assuming DB #2 mirrors prod)

Running every file in `supabase/migrations/` against a fresh Supabase project **does not** produce a full mirror of prod. Some migration files reference columns/tables that were renamed in prod, and some tables prod actually uses (`calendar_connections`, `crisis_alerts`, `waitlist`, `intake_forms`, `intake_tokens`, `onboarding_submissions`) were never captured as migration files — they were created via ad-hoc SQL pasted into the prod dashboard.

**What this means:**
- EHR-critical tables are present: `practices`, `users`, `patients`, `appointments`, `call_logs`, `sms_conversations`, `audit_logs`, `therapists`, `patient_assessments`, `patient_communications`, `practice_analytics`, `session_notes`, `insurance_records`, `eligibility_checks`, `stedi_payers`, and more.
- Legacy Harbor tables listed above are missing. If you navigate to `/dashboard/calendar` or similar routes that query those tables, you'll see 500 errors. That's expected on DB #2; it's not a regression.

**Closing the gap (later task, not blocking EHR work):**
Before we merge `feature/ehr-v0` → `main`, we need a proper prod-schema dump to re-verify DB #2 matches prod for all tables EHR touches. Cleanest path: have Chance run `supabase db dump --schema-only` against prod (one-time Supabase CLI install on his laptop), apply the output to DB #2, then re-run `ehr:bootstrap` to layer EHR-specific migrations on top.

---

## Weekly discipline

Every week, from `feature/ehr-v0`:

```bash
git fetch origin
git merge origin/main            # pull any prod-side changes
npm run ehr:bootstrap            # re-apply any new prod migrations to DB #2
```

If `git merge` produces conflicts in `supabase/migrations/`, the newer prod migrations win; keep the EHR-specific migrations (`ehr_*.sql`) untouched.

---

## Adding a new EHR table / column

1. Write the migration file:
   ```
   supabase/migrations/YYYYMMDD_ehr_<thing>.sql
   ```
   Follow conventions in [ehr-branch-setup.md §5](./ehr-branch-setup.md): `ehr_*` table prefix, `practice_id` FK, `created_at`/`updated_at`, RLS enabled.

2. Apply to DB #2:
   ```bash
   npm run ehr:bootstrap
   npm run ehr:inspect    # confirm the new table appears
   ```

3. Build the feature. Feature-flag gate every new route and UI with `ehr_enabled` (see [ehr-branch-setup.md §3](./ehr-branch-setup.md)).

4. Commit and push:
   ```bash
   git add supabase/migrations/YYYYMMDD_ehr_<thing>.sql app/ lib/ components/
   git commit -m "feat(ehr): <what>"
   git push
   ```

---

## Guardrails

- `.env.ehr` is gitignored. **Never commit it.** If you see it staged, `git restore --staged .env.ehr` before committing.
- **Never paste prod Supabase keys into `.env.ehr`.** The anon/service keys there are tied to DB #2 only. Prod keys live in `.env.local` and in Railway's `harbor-app` service.
- **Never paste DB #2 keys into `.env.local` or Railway.** Same reason, opposite direction.
- **Never `pg_dump` DB #2 onto prod.** Schema changes cross via migration files only.
- When in doubt about whether a command will hit prod, check which env the script uses. `.env.ehr` scripts have a `SUPABASE_DB_URL` that contains `badelywhoacuccztxhjh`. Any script should refuse to run if it doesn't see that project ref (our bootstrap/seed scripts already enforce this).
