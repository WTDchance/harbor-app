# EHR-v0 branch setup — isolation + seamless reintegration

A runbook for building the EHR module on a separate branch without touching the
production-ready Harbor AI receptionist, then merging it back cleanly when it's
ready. Two goals that pull in opposite directions:

1. **Isolation now.** Nothing the EHR branch does should ever deploy to prod
   accidentally or slow down the push to 10 customers. `main` is sacred.
2. **Seamless reintegration later.** When we flip the switch, the EHR module
   must look, feel, and behave like Harbor — same design language, same data
   patterns, same auth, same deploy pipeline. No "bolted-on second app" feel.

The two goals are achievable simultaneously if we follow a few strict conventions.

---

## 1. Branch setup

### Create the branch

From a clean `main` (pulled to current):

```bash
git checkout main
git pull origin main
git checkout -b feature/ehr-v0
git push -u origin feature/ehr-v0
```

That's it. `main` continues to be the deploy-to-prod branch. `feature/ehr-v0`
is your playground. Railway does **not** auto-deploy from feature branches, so
even if you push broken code to `feature/ehr-v0` at 2 AM, prod is untouched.

### Keep the branch fresh

Weekly, rebase or merge `main` into `feature/ehr-v0` so you don't accumulate
conflicts. From the feature branch:

```bash
git fetch origin
git merge origin/main
# resolve any conflicts, commit, push
```

If the feature branch gets older than ~2 weeks without a merge-down, the
reintegration PR becomes painful. Don't let that happen.

### When to merge back to main

Only when **all** of these are true:

- TypeScript is clean (`tsc --noEmit` passes).
- The feature flag (see §3) defaults to `false` so zero existing practices see
  new surface area.
- New migrations have been dry-run against a test database and apply cleanly.
- A complete EHR workflow (e.g. "create progress note, sign it, attach to an
  appointment") works end-to-end locally or in staging.
- The `main` branch is clean and deployable on its own.

Squash-merge is preferred — one clean commit per EHR feature.

---

## 2. Folder + naming conventions

Parallel directory trees under the existing app, so it's obvious which code
belongs to which module.

### UI routes

- **User-facing EHR pages:** `app/dashboard/ehr/*` (e.g. `app/dashboard/ehr/notes/page.tsx`)
- **Admin-facing EHR pages:** `app/admin/ehr/*`
- **Patient portal (future):** `app/portal/*`

### API routes

- All EHR endpoints under `app/api/ehr/*`:
  - `app/api/ehr/notes/route.ts`
  - `app/api/ehr/notes/[id]/route.ts`
  - `app/api/ehr/treatment-plans/route.ts`
  - `app/api/ehr/claims/route.ts`

### Libraries

- Shared EHR logic under `lib/ehr/*` (e.g. `lib/ehr/note-templates.ts`,
  `lib/ehr/stedi-claims.ts`, `lib/ehr/cpt.ts`).
- **Never duplicate** anything from `lib/*`. Import `supabaseAdmin`,
  `resolvePracticeIdForApi`, `sendEmail`, `buildSystemPrompt` from their
  existing homes. If you need to extend a shared function, extend in place,
  don't fork.

### Database

- All EHR tables prefixed with `ehr_`: `ehr_progress_notes`, `ehr_treatment_plans`,
  `ehr_claims`, `ehr_superbills`, `ehr_cpt_codes`, `ehr_icd10_codes`.
- Migrations named `YYYYMMDD_ehr_<thing>.sql`.
- This makes it trivial to drop the entire EHR schema if we ever need to roll
  back: `DROP TABLE` on everything with the prefix.

### Components

- EHR-specific React components under `components/ehr/*`.
- Reuse every existing primitive from `components/*` (buttons, modals,
  form fields, badges). **Do not** reskin the design system for EHR.

---

## 3. Feature-flag gating

The EHR is opt-in per practice. Before any EHR UI or API is callable, the
authenticated user's practice must have the flag on.

### Migration

```sql
-- First EHR migration. Run this once on the feature branch.
ALTER TABLE practices
  ADD COLUMN IF NOT EXISTS ehr_enabled BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN practices.ehr_enabled IS
  'When true, EHR module (notes, claims, treatment plans) is visible and operable for this practice.';
```

### UI gate

At the top of every EHR page component:

```tsx
const { practice, loading } = usePractice()
if (loading) return <Spinner />
if (!practice?.ehr_enabled) {
  return <ComingSoon feature="EHR" />
}
```

### API gate

In every EHR API route, before doing any work:

```ts
const { data: practice } = await supabaseAdmin
  .from('practices')
  .select('ehr_enabled')
  .eq('id', practiceId)
  .single()

if (!practice?.ehr_enabled) {
  return NextResponse.json({ error: 'EHR not enabled for this practice' }, { status: 403 })
}
```

### Enable for beta testers

Flip the flag from a SQL script or the admin dashboard:

```sql
UPDATE practices SET ehr_enabled = true WHERE id = '<beta practice id>';
```

Mom's practice goes first. Then 2-3 more willing early adopters. When the
module is solid, we either flip it on globally or keep it as a paid add-on tier.

---

## 4. Design-system conventions (so it looks like Harbor)

The existing app uses Tailwind utility classes with a consistent vocabulary.
Match this exactly so EHR pages don't feel like a different app.

### Color palette

| Purpose | Class |
|---|---|
| Primary action | `bg-teal-600 hover:bg-teal-700 text-white` |
| Primary text / links | `text-teal-700 hover:text-teal-900` |
| Destructive | `bg-red-600 hover:bg-red-700 text-white`, `text-red-600` |
| Warning / attention | `bg-amber-50 text-amber-800 border-amber-200` |
| Success / confirmed | `bg-emerald-50 text-emerald-700 border-emerald-200` |
| Info / neutral | `bg-blue-50 text-blue-700 border-blue-200` |
| Muted text | `text-gray-500`, `text-gray-400` (finer) |

### Typography

- Body: `text-sm text-gray-700` for most content.
- Headings: `font-semibold text-gray-900`; section headers use
  `text-sm uppercase tracking-wide` for small caps style.
- Metadata: `text-xs text-gray-500`.
- Numbers / dollar amounts that need emphasis: `text-3xl font-bold`.

### Containers

- Cards: `bg-white rounded-xl border border-gray-200 p-5` (or `p-6` for larger
  emphasis). Use `mb-6` to space stacked cards.
- Section divider inside a card: `border-t border-gray-100 pt-4`.

### Forms

- Input style:

  ```tsx
  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm
             focus:outline-none focus:ring-2 focus:ring-teal-500"
  ```
- Label: `block text-sm font-medium text-gray-700 mb-1`.
- Hint: `block text-xs text-gray-500 mt-1`.
- Error text: `text-xs text-red-600`.

### Modals

Follow the pattern in `app/dashboard/patients/[id]/page.tsx` (the
Billing-Mode modal). Structure:

```tsx
{showModal && (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
    <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 max-h-[90vh] overflow-y-auto">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">Modal title</h3>
      {/* content */}
      <div className="mt-6 flex items-center justify-end gap-2">
        <button className="px-4 py-2 text-sm font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-100">Cancel</button>
        <button className="px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700">Confirm</button>
      </div>
    </div>
  </div>
)}
```

### Badges

Follow the pattern in the `BillingModeBadge` component (`app/dashboard/patients/[id]/page.tsx`).
Rounded pill, border + bg + fg colors from the palette above, `px-2.5 py-1
rounded-full text-xs font-medium border`.

### Reference pages to copy structure from

- **Cards + sections layout:** `app/dashboard/settings/page.tsx`
- **Tabbed navigation:** same file (tab bar section)
- **List view with inline edit modal:** `app/admin/leads/page.tsx` (the ROI
  leads pipeline)
- **Detail page with mixed panels:** `app/dashboard/patients/[id]/page.tsx`

When in doubt, open one of these four files and match the structure.

---

## 5. Data-model conventions

Every new table must:

1. Have `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`.
2. Have `practice_id UUID NOT NULL REFERENCES practices(id) ON DELETE CASCADE`.
3. Have `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`.
4. Have `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()` when the row is
   mutable after creation.
5. Enable RLS and add practice-scoped policies mirroring the `therapists` table
   (`20260419_therapists.sql` is the reference).

### Enums via CHECK constraints, not Postgres `ENUM` types

Postgres `ENUM` types are difficult to alter. Use `TEXT` + a `CHECK`:

```sql
stage TEXT NOT NULL DEFAULT 'draft'
  CHECK (stage IN ('draft', 'signed', 'amended', 'deleted'))
```

### Money in cents (bigint)

```sql
amount_cents BIGINT NOT NULL
```

Never store dollars as floats. UI converts to dollars at display time.

### PHI considerations

- Progress notes are PHI. Audit every read/write — use the existing
  `audit_log` table (`20260416_audit_log_table.sql`).
- Encrypted at rest is free via Supabase. Encrypted in transit is handled by
  HTTPS + Supabase client libraries.
- For unusually sensitive fields (e.g. narrative note body), consider a
  separate row-level encryption pass via `pgcrypto` if the HIPAA attorney flags
  it. Default without that extra: normal Supabase encryption is compliant.

---

## 6. API conventions

Two auth patterns are in use; pick by caller:

### Pattern A: Client-side React component hitting API via `fetch`

Used when the dashboard UI calls the API with the user's Supabase JWT:

```ts
// Client
const { data: { session } } = await supabase.auth.getSession()
const res = await fetch('/api/ehr/notes', {
  headers: { Authorization: `Bearer ${session.access_token}` },
})
```

```ts
// Server
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { resolvePracticeIdForApi } from '@/lib/active-practice'

const token = req.headers.get('authorization')?.slice(7)
const { data: { user } } = await supabase.auth.getUser(token)
if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
const practiceId = await resolvePracticeIdForApi(supabase, user)
```

### Pattern B: Server component or page fetch via cookies

```ts
import { createClient } from '@/lib/supabase-server'
import { getEffectivePracticeId } from '@/lib/active-practice'

const supabase = await createClient()
const { data: { user } } = await supabase.auth.getUser()
if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
const practiceId = await getEffectivePracticeId(supabase, user)
```

### Always use `supabaseAdmin` for writes

Reason: the dashboard uses an act-as cookie that switches the effective
practice. User-scoped clients silently fail under RLS in that path. Always
authenticate with the user-scoped client, resolve the practice ID, then
`supabaseAdmin.from(...).update(...)` for the actual mutation.

### Standard response shapes

```ts
// Success
return NextResponse.json({ note: data })         // single item
return NextResponse.json({ notes: data })        // collection
return NextResponse.json({ success: true, ... }) // action with side effects

// Error
return NextResponse.json({ error: 'message' }, { status: 400 | 401 | 403 | 404 | 500 })
```

No bare 200 with empty body. No throwing uncaught exceptions.

---

## 7. Testing strategy

Three options, in order of how much isolation they buy:

### Option A (default): Local dev + feature flag on demo practice

- `npm run dev` runs locally on port 3000.
- Local Next.js reads env from `.env.local`, same as prod.
- Connect to production Supabase (acceptable for read-heavy dev; avoid
  destructive operations).
- Set `ehr_enabled = true` on the Harbor Demo practice (`172405dd-65f9-...`).
  Nobody else sees EHR surface area.
- Iterate here for the first ~80% of EHR work.

### Option B: Staging environment (recommended for claim testing)

- Create a second Supabase project: **Harbor Staging**. Clone the schema with
  `supabase db diff` or apply all migrations to a fresh project.
- Create a second Railway service: **harbor-staging**. Point it at the
  staging Supabase URL + service role key.
- Configure a staging domain (`staging.harborreceptionist.com`) in Railway.
- Auto-deploy this service from the `feature/ehr-v0` branch.
- Use this for claim submission testing so you never risk sending garbage
  claims from prod.

Cost: ~$10/mo Railway + $25/mo Supabase = **$35/mo** for a full isolated
staging environment. Cheap insurance for anything that touches real payers.

### Option C: Feature flag on prod, beta user only

Once a feature works locally, merge to `main` with `ehr_enabled = false`
default. Flip the flag on mom's practice only. Real-world beta test. Rollback
is a single SQL statement:

```sql
UPDATE practices SET ehr_enabled = false WHERE id = '<practice id>';
```

Use Option C for anything that's "99% works but I want to see it under real
load."

### What NOT to do

- **Do not** run migrations directly against prod from the feature branch.
  Migrations go in via `main` after the PR is merged.
- **Do not** call Stedi's live claim submission from the feature branch
  without being on staging. Stedi has a sandbox mode — use it.
- **Do not** copy-paste existing code into `lib/ehr/*` duplicates. If shared
  logic needs extending, extend in place.

---

## 8. Suggested build order (so value ships early)

Each bullet is an independent shippable slice. Stop at any point if priorities
change — each one has standalone value.

1. **Migration + schema bootstrap** (`20260XXX_ehr_core.sql`): add
   `practices.ehr_enabled`, create `ehr_progress_notes` table with basic
   fields (title, body, signed_at, signed_by, patient_id, appointment_id,
   practice_id).
2. **Progress note CRUD** (`app/api/ehr/notes/*` + `app/dashboard/ehr/notes/*`):
   list, create, edit, sign. No AI yet — therapist writes manually. Ships the
   data loop.
3. **AI-drafted notes** (`lib/ehr/draft-note.ts`): take a call recording or
   transcript, generate SOAP draft via Claude Sonnet, therapist edits.
   This is the killer feature; everything else is table stakes.
4. **CPT + ICD-10 pickers** (`lib/ehr/cpt.ts`, `lib/ehr/icd10.ts`,
   `components/ehr/CodePicker.tsx`): seed tables from public datasets (CMS
   publishes these). Used on every note and later on claims.
5. **Treatment plans** (`ehr_treatment_plans`): simpler than notes — template
   + periodic review workflow.
6. **Superbills** (PDF generation via `@react-pdf/renderer`): easiest billing
   output. Handles self-pay patients + OON reimbursement claims.
7. **Claims via Stedi 837** (`lib/ehr/stedi-claims.ts`): the real moat.
   Needs to handle: claim creation from a signed note + CPT + ICD-10, Stedi
   sandbox testing, production submission, 835 ERA ingestion + reconciliation.
8. **Patient portal** (`app/portal/*`): phased — start with "view upcoming
   appointments + sign forms + see invoices," add messaging later.
9. **Audit log hardening:** ensure every PHI access writes to `audit_log`.
10. **Supervision workflow** (future, multi-therapist practices only): co-sign
    notes, hierarchy.

### Target cadence

- Steps 1-3: 2-3 weeks. This alone is compelling.
- Steps 4-6: 1 week. Rounds out "real EHR-lite."
- Step 7: 1-2 weeks. Depends on Stedi sandbox learning curve.
- Steps 8-10: 2-4 weeks. Patient portal is the longest single piece.

Total focused work, one engineer, clean happy paths: **5-8 weeks** for a
practice to be fully operational on Harbor EHR end-to-end. Not one week, but
not 12-18 months either.

---

## 9. What's shared vs isolated

### Shared (must not diverge)

- `lib/supabase.ts` + `lib/supabase-server.ts` (auth)
- `lib/active-practice.ts` (act-as + practice resolution)
- `lib/email.ts` + `EMAIL_SALES`, `EMAIL_SUPPORT` constants
- `lib/systemPrompt.ts` (Ellie's brain — do not break)
- `lib/audit.ts` (audit log writer)
- `lib/crisis-phrases.ts` + crisis detection (any note content that looks
  crisis-related should trigger the same pathway)
- Patient / appointment / practice tables (extend, don't fork)
- Design tokens (colors, spacing, typography)

### Isolated

- Everything under `app/*/ehr/*`, `app/api/ehr/*`, `lib/ehr/*`,
  `components/ehr/*`, `ehr_*` tables.

### When the line blurs

If an EHR feature needs to extend a shared resource (e.g. adding a column to
`appointments` for `completed_note_id`), make that change on `main` first, then
merge down into `feature/ehr-v0`. Never fork a shared table into EHR-private
and core-private versions.

---

## 10. Reintegration checklist

When ready to merge `feature/ehr-v0` → `main`:

- [ ] `tsc --noEmit` passes on the feature branch
- [ ] Every new migration has been dry-run against staging
- [ ] Every EHR route has its auth + feature-flag check
- [ ] `ehr_enabled` defaults to `false` in the shipped migration
- [ ] Reference pages (settings, patients detail, admin leads) haven't been
      modified on `feature/ehr-v0` in ways that could clobber `main` changes
- [ ] A human (Chance) has clicked through the EHR flow on staging at least
      once, end-to-end
- [ ] The GitHub PR description lists every new table, every new env var (if
      any), every new external dependency
- [ ] Post-merge, manually enable `ehr_enabled` on the demo practice and mom's
      practice to validate the live deploy

Squash-merge. Deploy. Watch Railway for green. Then flip the flag for mom.
