# Cancellation policy — Wave 42 settings UI handoff

The schema, backend, and patient-facing surfaces are live on
`parallel/aws-v1`. The Settings UI was deliberately punted to avoid
colliding with the Wave 42 second coder's practice-settings work.

This file is the handoff: drop a "Cancellation policy" card on the
existing Practice settings page in `app/dashboard/settings/page.tsx`
that consumes the endpoint below.

## Endpoint

`GET  /api/ehr/practice/cancellation-policy`
`PUT  /api/ehr/practice/cancellation-policy`

`GET` response shape:

```json
{
  "policy_hours": 24,
  "cancellation_fee_cents": 5000,
  "no_show_fee_cents": 7500,
  "policy_text": "Cancellations with less than 24 hours' notice will be charged $50."
}
```

`PUT` body accepts any subset of the same keys. Pass `null` for
`policy_hours` to **disable** the policy entirely (the backend treats
NULL as opted-out and never charges fees).

The endpoint:
- validates `policy_hours` ∈ [0, 168] integer
- validates fee cents are non-negative integers
- writes a `cancellation_policy.configured` row to `audit_logs` with the
  fields that changed.

## UI sketch (4 fields)

1. Hours threshold (number input, blank = disabled)
2. Late-cancel fee (dollar input → cents on submit)
3. No-show fee (dollar input → cents on submit)
4. Policy text (textarea, shown verbatim to patients on cancel + scheduling)

Display a clear "Disabled — no fees charged" hint when `policy_hours`
is empty/null.

## Why this is mandatory

Patients see the disclosure text on the public cancel page
(`app/appointments/[id]/cancel/page.tsx`) and via the portal-side
`CancellationPolicyDisclosure` component. **A practice must populate
`policy_text` if it wants the fee to be enforceable** — without
disclosure, the fee can be reversed on chargeback grounds.

## What ships today (without the settings UI)

- Migration `supabase/migrations/20260427_cancellation_policy.sql`
- `lib/aws/ehr/cancellation-policy.ts` (assess + enforce + waive)
- `app/api/ehr/appointments/[id]/waive-fee/route.ts` (therapist override)
- `components/ehr/WaiveFeeButton.tsx` (drops into the appointment edit modal)
- `components/portal/CancellationPolicyDisclosure.tsx`
- Hooked into the public email-link cancel page, the Retell voice
  cancel tool, and the EHR PATCH no_show transition.

Until the settings UI lands, practices can opt in by running:

```sql
UPDATE practices
   SET cancellation_policy_hours  = 24,
       cancellation_fee_cents     = 5000,
       no_show_fee_cents          = 7500,
       cancellation_policy_text   = 'Cancellations with less than 24 hours notice will be charged $50.'
 WHERE id = 'xxx';
```
