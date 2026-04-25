# Cancellation Fill — Engineering Design Doc

*Internal. Drafted 2026-04-20. Scope: design & implementation plan for the full 4-bucket fill system described in `docs/cancellation-policy.md`.*

---

## Current state (as of 2026-04-20)

**What's live:**
- `/api/cancellation/confirm/route.ts` — patient taps "cancel" link, marks appointment cancelled, deletes Google event
- `/api/cancellation/fill/route.ts` — rudimentary fill: fetches waitlist, matches basic preferred-times string, sends one SMS
- `waitlist` table with rows scoped by practice
- `appointments.status = 'cancelled'`
- No time-bucket differentiation
- No exclusion rules beyond SMS opt-out
- No practice-level settings for fill behavior
- No cascade (refilling a slot if the waitlist person also cancels)

**What's missing:**
- The 4-bucket time-based dispatcher
- Practice-level settings for auto-fill behavior
- Per-therapist policy overrides
- Exclusion rules (crisis, no-show pattern, outstanding balance, intake incomplete)
- Composite scoring for waitlist ordering
- Parallel offers with first-claim-wins
- Cascading fill on secondary cancellation
- "Shift earlier" flow (text next-appointment patient to come in sooner)
- Insurance eligibility gate (Stedi pre-check before auto-confirm)
- Therapist-facing notification tiering (digest vs. SMS alert)
- Audit trail for offers / declines / claims per slot

---

## Design

### Phase 1 — Foundation (ship this first, ~1 day)

**Goal:** Add the scaffolding so future logic has places to live, without changing existing behavior.

**Schema migration:**
```sql
-- Practice-level cancellation/fill settings.
-- IMPORTANT: the column is named `cancellation_fill_settings` (NOT
-- `cancellation_policy`) because `cancellation_policy TEXT` already exists
-- on the practices table — it stores freeform policy text that Ellie reads
-- aloud. Keep the two distinct.
ALTER TABLE practices
  ADD COLUMN IF NOT EXISTS cancellation_fill_settings JSONB NOT NULL DEFAULT '{
    "dispatcher_enabled": false,
    "auto_fill_24plus": true,
    "auto_fill_8_to_24": true,
    "auto_fill_2_to_8": true,
    "sub_1_hour_action": "shift_earlier",
    "late_cancel_fee_cents": 0,
    "waitlist_sort": "fifo",
    "flash_fill_max_recipients": 2,
    "insurance_eligibility_gate": true,
    "crisis_lookback_days": 14,
    "no_show_lookback_days": 30,
    "no_show_threshold": 2,
    "outstanding_balance_threshold_cents": 0
  }'::jsonb;

-- Waitlist flags for opt-in behavior.
ALTER TABLE waitlist
  ADD COLUMN IF NOT EXISTS flexible_day_time BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS opt_in_last_minute BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS opt_in_flash_fill BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS composite_score NUMERIC;

-- Offer tracking: every fill attempt logged so we can audit + cascade.
CREATE TABLE IF NOT EXISTS cancellation_fill_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id UUID NOT NULL REFERENCES practices(id),
  original_appointment_id UUID REFERENCES appointments(id),
  offered_to_patient_id UUID REFERENCES patients(id),
  offered_to_waitlist_id UUID REFERENCES waitlist(id),
  slot_time TIMESTAMPTZ NOT NULL,
  bucket TEXT NOT NULL CHECK (bucket IN ('24plus','8_to_24','2_to_8','sub_1','shift_earlier')),
  channel TEXT NOT NULL CHECK (channel IN ('sms','email','both')),
  offered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  offer_expires_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','claimed','declined','expired','superseded')),
  claimed_at TIMESTAMPTZ,
  created_appointment_id UUID REFERENCES appointments(id),
  notes TEXT
);

CREATE INDEX idx_fill_offers_practice_status ON cancellation_fill_offers(practice_id, status);
CREATE INDEX idx_fill_offers_slot ON cancellation_fill_offers(slot_time) WHERE status = 'pending';
```

**Code scaffolding (no behavior change):**
- `lib/cancellation-fill/types.ts` — shared types for buckets, offers, decisions
- `lib/cancellation-fill/bucket.ts` — pure function `computeBucket(slot, now) → 'sub_1' | '2_to_8' | '8_to_24' | '24plus'`
- `lib/cancellation-fill/exclusions.ts` — pure function `isExcluded(patient, practice, policy) → { excluded, reason }`
- `lib/cancellation-fill/policy.ts` — load + merge practice policy JSON with defaults
- Unit tests for the above

### Phase 2 — Bucket dispatcher (~1 day)

`/api/cancellation/dispatch/route.ts` — new entry point called by `/api/cancellation/confirm` after marking the appointment cancelled. Takes the cancelled appointment row, computes the bucket, and either routes to the appropriate handler OR flags for therapist review.

```ts
// Pseudocode
async function dispatch(cancelledAppt) {
  const bucket = computeBucket(cancelledAppt.scheduled_at, new Date())
  const policy = await loadPolicy(cancelledAppt.practice_id)
  const enabled = settings[`auto_fill_${bucket}`] // keyed from cancellation_fill_settings

  if (!enabled) return flagForTherapistReview(cancelledAppt)

  switch (bucket) {
    case '24plus': return fill24PlusHr(cancelledAppt, policy)
    case '8_to_24': return fill8To24Hr(cancelledAppt, policy)
    case '2_to_8': return fill2To8Hr(cancelledAppt, policy)
    case 'sub_1': {
      if (policy.sub_1_hour_action === 'shift_earlier') return shiftNextApptEarlier(cancelledAppt)
      if (policy.sub_1_hour_action === 'flash_fill') return flashFill(cancelledAppt, policy)
      return acceptLoss(cancelledAppt, policy)
    }
  }
}
```

### Phase 3 — Bucket handlers (~2-3 days)

Each bucket handler implements:
1. Candidate list: query waitlist + eligible patients per bucket rules
2. Apply exclusions: filter out crisis, no-show pattern, intake-incomplete, opt-out
3. Sort: FIFO or composite score (policy-driven)
4. Eligibility gate: Stedi check for insured candidates if policy requires
5. Send offers: SMS / email with claim link, record in `cancellation_fill_offers`
6. Timeout handler: a scheduled task checks pending offers and marks expired ones, moving to next candidate

**Unit of retry:** an offer that expires without claim cascades to the next candidate automatically (up to `flash_fill_max_recipients` simultaneously for 2-8 and sub-1 buckets).

### Phase 4 — Shift Earlier flow (~1 day)

Chance's idea: when a cancel lands <1hr before the slot, text the NEXT scheduled patient to see if they want to come in early. If they say yes:
1. Cancel their original later slot
2. Create new appointment at the freshly-opened earlier slot
3. Update Google Calendar
4. Re-trigger `/api/cancellation/dispatch` on their NEW (later) cancelled slot — which now has a larger time window and falls into a more fillable bucket

This is recursive in a nice way: each "shift earlier" acceptance increases the time horizon of the open slot by N hours, making it progressively easier to fill.

**Implementation:**
- New handler `shiftNextApptEarlier(cancelledAppt)` that:
  - Finds the same-practice next appointment for the same therapist, same day, within N hours after the cancelled slot
  - Sends an SMS: *"Dr. X has an earlier opening at 2pm instead of 3pm. Reply YES to move up."*
  - On YES: creates `cancellation_fill_offers` record of type `shift_earlier`, swaps appointments, then re-dispatches the newly-freed slot
  - On NO or timeout: falls back to `acceptLoss` or `flashFill` per policy

**Guardrail:** never shift a patient who:
- Has telehealth preference against in-person slot (or vice versa)
- Has a hard time constraint in their preferred_times (e.g., "never before noon")
- Has already been shifted earlier in the last 30 days (fairness)

### Phase 5 — Composite scoring (~1-2 days)

For practices with `waitlist_sort = 'composite'`:

```
score = (age_of_waitlist_entry_days × 2)
      + (prior_completed_sessions × 0.5)
      - (prior_no_shows × 3)
      + (insurance_status_weight × 1.5)
      + (last_visit_recency_weight × 1)
      - (outstanding_balance_cents / 10000)
```

Weights are policy-driven, letting a practice tune it. Stored in `waitlist.composite_score`, recomputed nightly via cron.

### Phase 6 — Per-therapist overrides (~2 days)

For group practices: some therapists love flash fills, some never want them. Add:

```sql
ALTER TABLE therapists
  ADD COLUMN IF NOT EXISTS cancellation_policy_override JSONB;
```

Resolution order when computing policy: therapist.override > practice.policy > system defaults.

### Phase 7 — Therapist-facing UI (~2 days)

Settings page → new "Scheduling" tab with all the policy toggles. Exposes `cancellation_policy` JSON as a form with clear defaults and descriptions.

Dashboard → new "Fill History" widget on the Appointments page showing:
- Cancellations today / this week
- Fill rate %
- Average time-to-fill per bucket
- Revenue saved (cancels that became filled × session rate)

### Phase 8 — Notifications & audit (~1 day)

- Morning digest email: "Last night we filled X cancels, flagged Y for your review"
- Real-time SMS for sub-8hr buckets
- Audit log in `cancellation_fill_offers` for every offer → easy to answer "why did this patient get this slot?"

---

## Data model summary

**Tables touched:**
- `practices` (new `cancellation_fill_settings` JSONB — see note above on why not `cancellation_policy`)
- `therapists` (new `cancellation_policy_override` JSONB, Phase 6)
- `waitlist` (new flags + composite_score)
- `cancellation_fill_offers` (NEW)

**Cron jobs to add:**
- Nightly: recompute `composite_score` for all waitlist entries
- Every 15 min: check `cancellation_fill_offers` for expired pending offers, cascade to next candidate
- Daily morning: send therapist digest email

---

## Risk + rollout

**Risk level per phase:**
- Phase 1 (migration): zero-risk additive
- Phase 2 (dispatcher): low — adds a new route, existing `/confirm` still works
- Phase 3 (handlers): medium — touches SMS send, real patients get real texts
- Phase 4 (shift earlier): medium — mutates existing appointments
- Phase 5 (scoring): low — just ordering, doesn't change who's eligible
- Phase 6 (overrides): low — additive
- Phase 7 (UI): low — new settings tab
- Phase 8 (notifications): low

**Rollout gates:**
- Phase 1-2 behind a feature flag per practice; default OFF for existing practices
- Enable for Harbor Demo first as a dogfood, then mom, then opt-in per practice
- Never auto-fill if `cancellation_fill_settings.dispatcher_enabled` is false on the practice (fail-closed default)

**Monitoring:**
- New Grafana panel (or dashboard widget): offers sent, offers claimed, offers expired, by bucket
- Sentry tracking for any handler failures
- Alert if fill rate drops below 40% for any practice over a 7-day window

---

## Out of scope for v1

- Referrals to other therapists in the practice ("Dr. A is busy but Dr. B is free")
- Multi-practice waitlist sharing (patient on waitlist for one practice offered a slot at sister practice)
- ML-driven scoring beyond the composite formula
- Bidding / preference markets (patient declines → practice doesn't have to contact them for N days)
- Integration with external waitlist tools (ZocDoc, Doxy.me)

All above are candidates for v2 once we have real data on how Phase 1-8 performs in the wild.

---

## Timeline estimate

| Phase | Est. time | Cumulative |
|---|---|---|
| 1. Foundation (migration + types) | 1 day | 1 |
| 2. Bucket dispatcher | 1 day | 2 |
| 3. Bucket handlers (3 buckets × ~1 day) | 3 days | 5 |
| 4. Shift Earlier flow | 1 day | 6 |
| 5. Composite scoring | 2 days | 8 |
| 6. Per-therapist overrides | 2 days | 10 |
| 7. Therapist UI | 2 days | 12 |
| 8. Notifications + audit | 1 day | 13 |

**Realistic total:** ~3 weeks of focused work, or ~6-8 weeks if sharing time with other priorities.

**Minimum viable version:** Phases 1-4 (~6 days). Covers the 80% of value: buckets, handlers, shift-earlier. Per-therapist overrides and composite scoring can come later.
