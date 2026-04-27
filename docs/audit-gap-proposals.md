# HIPAA audit-log gap — proposed action enum names

_Status: proposal only. No code changed yet._
_Author: paired follow-up to `docs/hipaa-audit-matrix.md` (Wave 36+T1.5)._
_Branch: `docs/audit-gap-proposals` → review → name freeze → 3-line patches per route._

## Why this is a doc and not a patch

The matrix (committed at `1900262` on `parallel/aws-v1`) flagged 8 PHI-touching
routes in `/api/ehr` and `/api/admin` that do not write to `audit_logs`. Each
fix is structurally a 3-line edit (`import auditEhrAccess`, call after the
success branch with a chosen action string, choose `details`).

The catch is that the action string is the *primary key on history*. Once a
row exists in `audit_logs` with `action = 'mood.list'`, that name is frozen —
renaming it later breaks every downstream query, alert, retention rule and
forensic search that filters by it. So we want naming agreed before code
lands, not after.

This document proposes the names and call signatures. The user reviews,
approves (or counter-proposes), and the patches become a single small PR.

## Naming convention (recap)

`lib/aws/ehr/audit.ts` defines `EhrAuditAction` as a TypeScript string-union
type, not an enum class. The convention in use across ~80 existing values:

* `dot.notation` — lower_snake_case segments separated by `.`
* singular nouns (`note`, `homework`, `treatment_plan`, `message`, `patient`)
* present-tense verbs as the suffix (`view`, `list`, `create`, `update`,
  `delete`, `sign`, `cosign`, `amend`)
* admin-side actions are prefixed with `admin.` (e.g. `admin.patient.delete`)
* portal-side actions are prefixed with `portal.` (e.g. `portal.mood.list`)

Because the existing values are present-tense, **this document does not use
the `VIEWED` / `CREATED` past-tense naming from the original briefing** —
that would split history across two conventions and make every dashboard
filter conditional. The matrix recommendations (`appointment.session.view`,
`homework.view`, etc.) are already in the existing convention; we follow that.

The original briefing also referenced `EhrAuditAction.HOMEWORK_VIEWED` as if
`EhrAuditAction` were a TypeScript `enum` — it is a string-union, so
`EhrAuditAction.HOMEWORK_VIEWED` would not compile. Action names are passed
as string literals (`action: 'homework.view'`).

## Call-site shape (all proposals share this pattern)

```ts
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

// …after the success branch, NEVER on the error branch (the helper
// already swallows its own errors so the primary op cannot be blocked):
await auditEhrAccess({
  ctx,
  action: 'mood.list',
  resourceType: 'ehr_mood_logs',
  resourceId: patientId,
  details: { count: rows.length },
})
```

`auditEhrAccess` already pulls `user_id`, `user_email`, `practice_id` from
`ApiAuthContext`. We never put PHI into `details` — counts, IDs, filter
parameters, and `target_*_id` are fine; names, narrative content,
diagnoses, dates of birth are not.

---

## EHR — 5 routes

### 1. `app/api/ehr/appointments/[id]/session/route.ts` (lines 12–65)

PHI touched: appointment session timing (`actual_started_at`,
`actual_ended_at`) for one patient — encounter-window data is PHI under
HIPAA when tied to a specific patient via `appointments.patient_id`.

**Proposed action enum names (4):**

| HTTP / body                                | action                          |
|--------------------------------------------|---------------------------------|
| `GET`                                      | `appointment.session.view`      |
| `POST { action: 'start' }`                 | `appointment.session.start`     |
| `POST { action: 'stop' }`                  | `appointment.session.stop`      |
| `POST { action: 'reset' }`                 | `appointment.session.reset`     |

**Proposed call signature (POST start case shown; mirror for stop/reset/GET):**

```ts
await auditEhrAccess({
  ctx,
  action: 'appointment.session.start',
  resourceType: 'appointment',
  resourceId: id,
  details: { actual_started_at: rows[0].actual_started_at },
})
```

**Open questions:**
* Three distinct POST actions vs. one `appointment.session.update` with the
  sub-action in `details`? I recommend distinct: a forensic query of "who
  closed the encounter on appointment X" should be a single equality filter,
  not a JSON probe. The cost is 3 strings instead of 1.
* `GET` for session-timer state is a low-information read (timestamps only,
  no narrative). Still worth auditing — read-of-PHI is the threshold,
  not amount-of-PHI — but reasonable to skip if the user wants to trim.

---

### 2. `app/api/ehr/homework/[id]/route.ts` (lines 12–43)

This file has only a `PATCH` handler. The matrix recommendation
(`homework.view / homework.update`) implies a separate `homework.view`
action; I'm only proposing `homework.update` here because the file in
question doesn't have a GET. (A `homework.view` action will likely be
needed when `app/api/ehr/homework/route.ts` or a fetch route gains an
audit gap — leaving the name reserved.)

PHI touched: assigned homework content (`title`, `description`, `due_date`,
`status`) for a specific patient — therapeutic content is PHI.

**Proposed action enum names (2):**

| trigger                                 | action                |
|-----------------------------------------|-----------------------|
| `PATCH` (default)                       | `homework.update`     |
| `PATCH` with `status = 'completed'`     | `homework.complete`   |

**Proposed call signature:**

```ts
const action: EhrAuditAction =
  body.status === 'completed' ? 'homework.complete' : 'homework.update'
await auditEhrAccess({
  ctx,
  action,
  resourceType: 'ehr_homework',
  resourceId: id,
  details: {
    fields_changed: Object.keys(body).filter(k => UPDATABLE.has(k)),
  },
})
```

**Open questions:**
* `homework.complete` vs. just `homework.update` with `status: 'completed'`
  in details? I recommend distinct — completion is a clinical milestone,
  not a generic edit, and you'll want to filter by it for outcome reporting.
* `homework.view` is **reserved** by this proposal but not used yet — if a
  fetch route is added later, it should adopt this name.

---

### 3. `app/api/ehr/messages/[id]/route.ts` (lines 13–72)

`GET` loads a thread + all messages and marks patient-sent messages as
read. `PATCH` and `DELETE` are 501 stubs (they return before touching
PHI, so they need no audit).

PHI touched: secure messaging content (full message bodies). High PHI.
Also a state mutation — `read_at` and `unread_by_practice_count` are
written as a side effect.

**Proposed action enum name (1):**

| HTTP   | action                  |
|--------|-------------------------|
| `GET`  | `message.thread.view`   |

**Proposed call signature:**

```ts
await auditEhrAccess({
  ctx,
  action: 'message.thread.view',
  resourceType: 'ehr_message_thread',
  resourceId: id,
  details: {
    message_count: msgRes.rows.length,
    messages_marked_read: thread.unread_by_practice_count,
  },
})
```

**Open questions:**
* Existing enum has `message.list`, `message.send`, `message.read`, and
  `message.thread.upsert`. `message.thread.view` slots cleanly in.
  An alternative — `message.thread.read` — collides semantically with
  `message.read` (which already means "marked as read by the recipient");
  I recommend against it.
* The `read_at` mutation could in principle generate one audit row per
  message. That's an explosion of audit rows for what is a single user
  action. I recommend the single thread-level audit with
  `messages_marked_read` in `details` instead.
* When `PATCH` / `DELETE` get implemented, they will need
  `message.thread.update` and `message.thread.delete` (likely also
  `message.thread.archive`). **Reserve those names now.**

---

### 4. `app/api/ehr/mood-logs/route.ts` (lines 11–29)

Therapist-side fetch of one patient's last 90 mood log rows
(`mood`, `anxiety`, `sleep_hours`, `note`, `logged_at`).

PHI touched: self-report symptom data — clinical content.

**Proposed action enum name (1):**

| HTTP   | action       |
|--------|--------------|
| `GET`  | `mood.list`  |

**Proposed call signature:**

```ts
await auditEhrAccess({
  ctx,
  action: 'mood.list',
  resourceType: 'ehr_mood_logs',
  resourceId: patientId,         // logs are scoped to one patient
  details: { count: rows.length },
})
```

**Open questions:**
* This file is GET-only. The matrix recommended `mood.list / mood.create`
  but the create path lives on the patient portal side and already has a
  dedicated action (`portal.mood.create`). I'm not proposing a therapist-
  side `mood.create` until a route requiring it actually appears.
* Setting `resourceId = patientId` (rather than null) so the audit row is
  filterable by `(action='mood.list' AND resource_id = '<patient_uuid>')`
  for forensic queries. This is the same shape as
  `app/api/ehr/patients/[id]/recent-diagnoses` proposal below.

---

### 5. `app/api/ehr/patients/[id]/recent-diagnoses/route.ts` (lines 19–58)

Returns up to 30 ICD-10 codes that have appeared in this practice's
signed notes or active treatment plans in the last 90 days.

PHI touched: ICD-10 codes are PHI even in aggregate. Defensible practice
is to log every read.

**Proposed action enum name (1):**

| HTTP   | action                       |
|--------|------------------------------|
| `GET`  | `diagnoses.recent.list`      |

**Proposed call signature:**

```ts
await auditEhrAccess({
  ctx,
  action: 'diagnoses.recent.list',
  resourceType: 'patient',
  resourceId: id,                       // the [id] route param (patient UUID)
  details: { count: rows.length },
})
```

**Open questions / red flag:**
* **The route's SQL ignores the `[id]` path parameter.** The `WHERE`
  clause is `practice_id = $1` only — there's no `patient_id = $X`
  filter. So either (a) the result is intended to be practice-wide
  (in which case the route should not live under `patients/[id]/`), or
  (b) the result should be patient-scoped and the SQL is buggy. This
  is a separate bug worth filing; for the audit row we still want
  `resourceId = id` so the call site is forensically informative even
  if the underlying query is broader than the URL implies.
* The catch-all silently returns `{ codes: [] }` when the schema is
  missing required columns. Audit row should still fire on the success
  branch only — the empty fallback is not a PHI access event.

---

## Admin — 3 routes

### 6. `app/api/admin/patients/route.ts` (lines 19–46)

Lists patients (id, names, email, phone, date of birth, status) for a
caller-specified `practice_id`, up to 2000.

PHI touched: bulk patient demographic data including DOB. High PHI.

**Proposed action enum name (1):**

| HTTP   | action                |
|--------|-----------------------|
| `GET`  | `admin.patient.list`  |

**Proposed call signature:**

```ts
await auditEhrAccess({
  ctx,                                   // requireAdminSession() returns ApiAuthContext
  action: 'admin.patient.list',
  resourceType: 'patient_list',
  resourceId: practiceId,                // the target practice, not the admin's home practice
  details: {
    target_practice_id: practiceId,
    limit,
    count: rows.length,
  },
})
```

**Open questions:**
* `auditEhrAccess` writes `ctx.practiceId` into the `practice_id` column.
  For an admin acting cross-practice, `ctx.practiceId` is the admin's
  home practice; the *target* practice is in the path. That's why we
  duplicate `target_practice_id` into `details` — without it, a query
  like "who looked at Hope and Harmony's patient list?" requires
  parsing `details->>'target_practice_id'` instead of indexing on
  `practice_id`. Worth confirming the existing `admin.patient.delete`
  call sites use the same pattern.
* Setting `resourceType` to `'patient_list'` (rather than `'patient'`) so
  list events and per-patient-row events stay distinguishable in
  audit dashboards. Existing convention seems to leave `resourceType`
  at the helper default (`'ehr_progress_note'`) when unset, which is
  wrong for admin paths — explicit value is recommended here.

---

### 7. `app/api/admin/roi-leads/route.ts` (lines 16–129) and `[id]/route.ts` (lines 22–91)

ROI calculator submissions filtered by stage / source / lookback (GET),
and per-lead stage/notes/conversion updates (PATCH).

PHI touched: **none** — these are pre-customer marketing leads. The
matrix author flagged them anyway as "should still be admin-audited"
on the principle that admin actions on customer-pipeline data are
audit-worthy regardless of PHI status.

**Proposed action enum names (2):**

| route + HTTP                          | action                       |
|---------------------------------------|------------------------------|
| `GET /api/admin/roi-leads`            | `admin.roi_lead.list`        |
| `PATCH /api/admin/roi-leads/[id]`     | `admin.roi_lead.update`      |

**Proposed call signatures:**

```ts
// GET — append before NextResponse.json on success
await auditEhrAccess({
  ctx,
  action: 'admin.roi_lead.list',
  resourceType: 'roi_calculator_submission_list',
  resourceId: null,
  details: { stage, source, days, count: leads.length },
})

// PATCH — append before NextResponse.json on success
await auditEhrAccess({
  ctx,
  action: 'admin.roi_lead.update',
  resourceType: 'roi_calculator_submission',
  resourceId: id,
  details: {
    fields_changed: sets,
    stage_set: body.stage ?? null,
    converted_practice_id: body.converted_practice_id ?? null,
  },
})
```

**Open questions:**
* The matrix used `admin.roi_leads` (plural). Existing convention is
  singular (`admin.patient.delete`, `admin.run_migration`, etc.) — I'm
  proposing `admin.roi_lead.*` (singular) to match. Flagging because the
  original recommendation was the plural form.
* PATCH could split into `admin.roi_lead.update` vs.
  `admin.roi_lead.convert` (when `converted_practice_id` is set). I
  recommend one action with `converted_practice_id` in `details` —
  conversion is a state on the same row, not a separate concept like
  homework.complete vs homework.update.

---

### 8. `app/api/admin/support/route.ts` (lines 11–55)

Cross-practice support tickets list, enriched with `practice_name`.

PHI touched: support ticket bodies *can* contain PHI when a therapist
files a ticket describing a patient situation. Treat as PHI-adjacent.

**Proposed action enum name (1):**

| HTTP   | action                          |
|--------|---------------------------------|
| `GET`  | `admin.support_ticket.list`     |

**Proposed call signature:**

```ts
await auditEhrAccess({
  ctx,
  action: 'admin.support_ticket.list',
  resourceType: 'support_ticket_list',
  resourceId: null,
  details: {
    status, priority, limit,
    count: tickets.length,
    practice_ids_touched: practiceIds.slice(0, 50),
  },
})
```

**Open questions:**
* If a `support/[id]/route.ts` exists or is planned for ticket detail
  view, it will need `admin.support_ticket.view`. **Reserve the name.**
* `practice_ids_touched` could be large; cap at 50 in `details` to keep
  audit rows compact (the full list is reconstructable from
  `support_tickets` itself by timestamp).

---

## Summary of names to add to `EhrAuditAction`

13 new string-literal members proposed (call out the 3 reserved names):

```ts
// Existing union — add the following:
| 'appointment.session.view'
| 'appointment.session.start'
| 'appointment.session.stop'
| 'appointment.session.reset'
| 'homework.update'
| 'homework.complete'
| 'message.thread.view'
| 'mood.list'
| 'diagnoses.recent.list'
| 'admin.patient.list'
| 'admin.roi_lead.list'
| 'admin.roi_lead.update'
| 'admin.support_ticket.list'

// Reserved (not used yet, but expected in near-future patches):
//   'homework.view'              — homework GET, when a route exists
//   'message.thread.update'      — when PATCH stub gets implemented
//   'message.thread.delete'      — when DELETE stub gets implemented
//   'message.thread.archive'     — likely sub-state of update
//   'admin.support_ticket.view'  — when /support/[id] route lands
```

## Recommended PR shape after approval

Per the matrix author's suggestion (`docs/hipaa-audit-matrix.md` →
"Suggested PR shape"), one commit per domain:

1. `feat(audit): EhrAuditAction additions (no behaviour change)`
2. `feat(audit): add audit calls to appointment session + homework + messages routes`
3. `feat(audit): add audit calls to mood-logs + recent-diagnoses`
4. `feat(audit): add audit calls to admin patients/roi-leads/support`

Each behaviour commit is a 3-line `import + call` per route plus the
import line at the top. Diff per commit should fit on one screen.
