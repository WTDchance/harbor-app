# Cancellation Fill — Ethical Boundaries

*Drafted 2026-04-20. This document defines hard limits that are enforced in code as mandatory gates, not configurable options. Practice-level policy can tune BEHAVIOR within these limits but cannot bypass them.*

---

## Why this document exists

Harbor is making automated decisions about who gets access to mental health care. Those decisions happen in minutes, at scale, and are invisible to the patient until a text arrives. Small choices in how we prioritize, exclude, and contact people compound into real equity and dignity outcomes. This document states the rules we will NOT break.

---

## Hard limits (enforced in code, not configurable)

### 1. Crisis-connected patients are never auto-offered a slot

If any patient in our system has a `crisis_alerts` row with `severity IN ('high','medium')` in the last `crisis_lookback_days` (default 14), they do NOT receive an auto-generated fill offer — regardless of how high their waitlist score is. The slot surfaces to the therapist for a clinical decision.

**Why:** Someone in or recently out of crisis is in a fragile state. An unexpected text saying "you can come in at 2pm today" could be destabilizing, or could feel like pressure. Crisis outreach should be therapist-initiated, not Harbor-initiated. This is a clinical judgment call, not an automation opportunity.

### 2. Opt-out flags are absolute

If a patient has `sms_opted_out = true`, we never send them an SMS offer — period. Same for email and call opt-outs. These flags cannot be bypassed by "urgency" or "high score" or practice preference.

**Why:** Consent to contact was revoked. Re-contacting them regardless of the reason erodes trust and may violate TCPA regulations independent of HIPAA.

### 3. No PHI leak in offer messages

Offer texts describe what the recipient is being offered, never what someone else did. We say "an opening" or "a slot" — we never say "because Jane cancelled" or "because patient X had to reschedule."

Bad: *"Dr. Wonser has an opening at 2pm because her 2pm patient cancelled. Want to come in?"*

Good: *"Dr. Wonser has an opening at 2pm today. Reply YES to claim it."*

**Why:** Even indirect PHI leakage ("someone cancelled") reveals that another patient exists and had an appointment. In small-town practices this can deanonymize real people.

### 4. Therapeutic continuity is preserved

A cancelled slot is tied to a specific therapist. Harbor never auto-offers that slot to a patient assigned to a different therapist in the same practice.

**Why:** Therapist-patient relationships are the core of clinical care. Offering Dr. A's opening to Dr. B's patient — even as a fill — can fracture continuity, trigger treatment history review, and create clinical risk. If a patient really needs a sooner slot with a different provider, that's a clinical transition, not a scheduling automation.

### 5. Identity verification is required for sensitive disclosures

Before we auto-fill a slot with a patient who hasn't had at least one prior session at the practice, the offer goes to therapist review. New patients require human judgment: are they clinically appropriate for this slot? Insurance OK? Crisis history check done?

**Why:** First-appointment fit is a clinical decision. Harbor should never book a brand-new patient's FIRST session without the therapist confirming.

### 6. Parallel offer recipients are told honestly when the slot is taken

When we offer a slot to 3 people simultaneously and one claims it, the other 2 receive a text within 60 seconds: *"Thanks for your quick reply! Someone else has claimed that slot. We'll keep you at the top of the list for the next opening."*

We never go silent. We never imply they "lost" — just that the slot filled. We affirm their position on the waitlist so the next offer doesn't feel like starting over.

**Why:** People deserve closure on requests. Silent timeouts erode trust. The re-affirmation of waitlist position preserves their sense of being cared for.

### 7. No discrimination by proxy in scoring

Composite scoring (Phase 5) may NOT include these factors, directly or as proxies:
- Race, ethnicity, national origin
- Religion
- Age (except to filter out minors where unavoidable)
- Sex, sexual orientation, gender identity
- Disability status (except to respect explicit accessibility needs)
- Pregnancy
- Marital or family status
- Veteran status
- Primary language (other than as needed for message localization)

**Permitted factors**: waitlist age (FIFO fairness), prior completed sessions (engagement), prior no-shows (reliability — but capped at 3x weight), insurance verification status (operational), last-visit recency (cadence), outstanding balance (operational — but capped).

**Why:** Protected attributes cannot legally or ethically influence access to healthcare. Even if a correlation exists in the data, encoding it in the score propagates discrimination. Insurance status is permitted but capped at low weight because it can correlate with class/race; it cannot be the deciding factor between two candidates.

### 8. No dark patterns in offer language

Offers use plain, neutral language. We do NOT use:
- Urgency exaggeration ("Last chance!" when it's not)
- Scarcity framing ("Only 1 slot left this month!" when more exist)
- Countdown timers in offer messages (already time-limited; no need to dramatize)
- Implied consequences for declining ("you may be removed from the waitlist")

**Why:** This is healthcare scheduling, not a limited-time sales event. Pressure tactics can coerce people into care they don't want, or create anxiety in an already-fragile population.

### 9. Late-cancel fees are recorded, never auto-charged

When a patient cancels under a practice's late-cancel-fee threshold, Harbor marks the appointment `cancelled_late` with the policy fee amount. Harbor does NOT auto-charge the patient's payment method.

**Why:** Deciding to waive a late fee (medical emergency, caregiver crisis, genuine misunderstanding) is a clinical/relational decision. Automating the charge makes the therapist complicit in penalizing someone whose circumstances they don't know.

### 10. Data retention respects minimum necessary

Rows in `cancellation_fill_offers` contain minimum info: patient ID (not full name), bucket, timestamps, status. Audit detail is sufficient for compliance without duplicating PHI across tables. Retention follows practice HIPAA retention policy (default 7 years).

**Why:** HIPAA Minimum Necessary rule. Audit trails should answer "what happened" without becoming parallel PHI stores.

---

## Soft guidelines (strongly recommended, configurable)

### A. Cap no-show-pattern exclusion at 2 months

If a patient has 2+ no-shows in the last 30 days (default threshold), they're held for therapist review rather than auto-offered. But this exclusion should not be permanent.

**Rationale:** No-show patterns often correlate with exactly the life circumstances that therapy is meant to address (ADHD, trauma symptoms, caregiver chaos, housing instability). Permanent exclusion deepens inequity. The 2-month lookback lets patterns reset when patients stabilize.

### B. Prefer existing patients over new patients within a bucket

When auto-filling, within the same waitlist bucket, prioritize patients with ≥1 prior session (measurable engagement) over fresh intakes (unknown fit). This reduces no-show risk on high-urgency slots without excluding anyone.

### C. Respect explicit preferred-times constraints

If a patient's `preferred_times` says "mornings only," don't auto-offer them an evening slot even if they're top of the waitlist. Surface to therapist instead.

### D. Offer fairness over response time

In FIFO sort mode, we contact the oldest waitlist entry first even if a newer entry "looks better" on other signals. Waitlist is a queue, not a market.

### E. Disclose the waitlist entry's position when denying a slot

When an offer expires or someone else claims it, we tell the recipient approximately where they are on the list ("You're currently #3 on our waitlist") so they can make informed decisions about continuing to wait.

---

## Review and changes

Changes to this document require explicit Chance approval before merge, not just CI passing. Any change that loosens a hard limit (Sections 1-10) requires documented reasoning in the PR.

This document is checked against by the cancellation-fill dispatcher via code-level gates (see `lib/cancellation-fill/exclusions.ts`). Disabling a gate in code requires changing this document too.
