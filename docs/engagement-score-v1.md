# Engagement / dropout-risk heuristic v1

`engagement_score` is a 0..1 composite where higher means more engaged.
`dropout_risk` is stored as `1 - engagement_score` so the UI can read
either kind directly without additional math.

`model_version`: `engagement.heuristic.v1`

## Inputs

All inputs come from `ehr_patient_signals`. No operational-table joins
in the heuristic itself; the daily ingestion cron is the single
gateway.

| # | Input | Weight | Range | Source |
|---|---|---|---|---|
| 1 | Portal logins per week, last 30 days | 0.20 | 0..1 | `portal_login` |
| 2 | Message-thread responsiveness | 0.15 | 0..1 | `portal_message_read` / `portal_message_sent` |
| 3 | Homework completion rate | 0.15 | 0..1 | `homework_completed` / `homework_missed` |
| 4 | Session attendance rate | 0.20 | 0..1 | `appointment_kept` / `appointment_no_show` / `appointment_late_cancel` |
| 5 | Cadence consistency (1 − CV of intervals) | 0.10 | 0..1 | inter-`appointment_kept` interval coefficient of variation |
| 6 | Days since last meaningful interaction | 0.10 | 0..1 | most-recent of: portal_login, portal_message_sent, reminder_response, appointment_kept, homework_completed, assessment_completed |
| 7 | Assessment completion in last 90 days | 0.10 | 0..1 | `assessment_completed` |
| | **Total** | **1.00** | | |

## Insufficient data

Brand-new patients (zero signals) score **0.5** (neutral) so the
inverse `dropout_risk` doesn't immediately flag them as at-risk. As
signals accrue over the first 2-3 weeks, the score becomes meaningful.

Per-input fallbacks:

- Portal-message responsiveness with 0 sent messages → 0.5 (unknown).
- Homework with 0 assignments → 0.5 (unknown).
- Attendance with 0 sessions → 0.5 (unknown).
- Cadence with <4 sessions → 0.5 (unknown — the CV is meaningless on
  fewer than 3 intervals).
- Days-since-last with no meaningful signals → 0.5 (unknown).

## Late-cancel handling

The attendance rate gives **half-credit** for a late cancel — the
patient was engaged enough to cancel rather than no-show, but it still
disrupts. Formula: `(kept + late_cancel * 0.5) / total`.

## Cadence consistency

For patients with ≥4 kept sessions, compute the coefficient of
variation of inter-session intervals (in days):

```
CV = stddev(intervals) / mean(intervals)
contribution = clamp(1 - CV, 0, 1)
```

A patient who reliably comes weekly has CV ≈ 0 → contribution ≈ 1.0.
A patient with very erratic spacing has high CV → contribution ≈ 0.

## Days-since-last contribution

Linear decay over 30 days: 0 days ago → 1.0, 30 days ago → 0.0,
clamped at zero beyond.

## Storage

The compute cron writes both rows in a single pass:

- `engagement_score` with the score
- `dropout_risk` with `1 - score` and `factors.summary` prefixed
  *"Inverse of engagement: …"*

Both rows share `model_version='engagement.heuristic.v1'`.

## Override

Same mechanism as no-show prediction. Therapist sets `override_score`
+ required `override_reason` from the patient detail page; subsequent
compute passes don't overwrite the override fields.

## Retirement criterion

Wave 46 trains an ML model on the labels these heuristics produce. The
heuristic retires when the ML model beats it on calibration + lift
across 60+ days of data on `/dashboard/admin/prediction-accuracy`.
Retirement is a one-line `ENGAGEMENT_MODEL_VERSION` swap and a code
swap of the heuristic body — the cron contract doesn't change.
