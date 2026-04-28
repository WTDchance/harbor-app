# No-show prediction heuristic v1

This is the formula behind the no-show probability shown on Today
screens and patient detail pages. It is a transparent weighted sum —
not a black-box model — so therapists can see exactly why a patient is
flagged and override when their judgment differs.

`model_version`: `no_show.heuristic.v1`

## Inputs

All inputs come from `ehr_patient_signals` (populated daily by
`/api/cron/ingest-patient-signals`) plus the appointment row itself.

| # | Input | Weight | Range | Source |
|---|---|---|---|---|
| 1 | Historical no-show rate (recency-weighted) | 0.25 | 0..1 | `appointment_kept` / `appointment_no_show` / `appointment_late_cancel` |
| 2 | Days since last no-show | 0.10 | 0..1 | most recent `appointment_no_show` |
| 3 | Reminder confirmation rate (inverted) | 0.15 | 0..1 | `reminder_sent` vs `reminder_response` |
| 4 | Outstanding balance aging | 0.10 | 0..1 | `balance_aged` (days_aged 14 → 90 → 0..1) |
| 5 | Day-of-week pattern | 0.10 | 0..1 | sub-rate of no-shows on appointment's weekday |
| 6 | Time-of-day pattern | 0.05 | 0..1 | sub-rate of no-shows in ±1h window |
| 7 | Booking lead time (U-shape) | 0.10 | 0..1 | `created_at` vs `scheduled_for` |
| 8 | Communication preference signal | 0.10 | 0..1 | recent `communication_preference_changed` (recent change ⇒ engaged ⇒ low contribution) |
| 9 | Retell call signals | 0.05 | 0..1 | `intent_to_cancel` / `hesitation_score` in `value` of recent `call_received` |
| | **Total** | **1.00** | | |

## Recency weighting

Inputs that aggregate over time use exponential decay with a 90-day
half-life:

```
weight_i = 0.5 ^ (days_ago_i / 90)
```

A no-show 30 days ago counts roughly 1.3× a no-show 90 days ago; 365
days ago is ~6% of present.

## U-shape on booking lead time

Both same-day and far-future bookings carry slightly elevated risk:

- 0 days → contribution 0.6
- 3..14 days (the "sweet spot") → contribution 0
- 14 days → 0
- 74 days → 0.6 (linearly scaled)

## Score

```
score = sum(weight_i × normalized_score_i)  clamped to [0, 1]
```

## Insufficient history

When a sub-input doesn't have enough history (fewer than 3 historical
appointments on the same weekday, or fewer than 3 in the same time
bucket), its contribution is 0 — the heuristic falls back to the other
inputs rather than fabricating signal from noise.

For brand-new patients with no historical appointments at all, the
`historical_no_show_rate` defaults to a 5% baseline. The other inputs
zero out cleanly. The first prediction is therefore close to 5% and
becomes meaningful as the patient accrues 3+ sessions.

## Override

A therapist can override any prediction from the patient detail page.
Override stores in `ehr_patient_predictions.override_score` with a
required reason. The compute cron preserves overrides on subsequent
runs (it updates `score`/`factors` underneath but won't touch the
override fields).

Overrides are themselves a signal: W46 will train an ML model that
learns when the heuristic was wrong by looking at override deltas.

## When to retire this heuristic

Wave 46 plans to train a gradient-boosted model on the labeled rows
this heuristic produces. Retirement criterion: when the GBT model
beats this heuristic on AUC across at least 60 days of labeled data
on the prediction-accuracy dashboard (`/dashboard/admin/prediction-accuracy`),
swap `NO_SHOW_MODEL_VERSION` and ship the swap as a single PR —
nothing else has to change.
