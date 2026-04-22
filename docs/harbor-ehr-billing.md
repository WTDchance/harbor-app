# Harbor EHR — Billing design

Harbor's billing module is built around one principle: **the signed progress note is the source of truth.** Every billable event in Harbor traces back to a signed note with a real CPT code, a real ICD-10 diagnosis, a real session duration, and a real therapist signature. No "orphan" charges, no typed-in line items, no retroactive fabrication.

This is the design document. Implementation lives under `supabase/migrations/20260422_ehr_billing.sql`, `app/api/ehr/billing/*`, `app/dashboard/ehr/billing/*`, and `components/ehr/Billing*`.

---

## The economic objects

Therapy practices need to track five distinct things. Harbor has a table for each.

### 1. Service — what was clinically done
**Where it lives:** `ehr_progress_notes` (already exists; notes already carry `cpt_codes`, `icd10_codes`, appointment linkage, and a signed hash).
**Why it matters:** This is the clinical truth. Everything else derives from it.

### 2. Charge — the billable amount for a service
**Table:** `ehr_charges`
Columns:
- `id`, `practice_id`, `patient_id`, `note_id`, `appointment_id`
- `cpt_code`, `units` (default 1)
- `fee_cents` — practice's usual-and-customary fee for this CPT
- `allowed_cents` — what the payer or self-pay patient is expected to owe (equals `fee_cents` for self-pay)
- `billed_to` — `'insurance' | 'patient_self_pay' | 'both'` (copay + insurance)
- `copay_cents` — patient's portion when `billed_to='both'`
- `status` — `'pending' | 'submitted' | 'partial' | 'paid' | 'denied' | 'written_off' | 'void'`
- `created_by`, `created_at`, `updated_at`

**Created automatically:** when a note is signed AND has at least one CPT code AND the practice is configured for auto-billing. Therapist can toggle auto-creation per-note.

### 3. Claim — an EDI 837 submission to a payer
**Table:** `ehr_claims`
Columns:
- `id`, `practice_id`, `charge_id` (FK)
- `payer_id` — references `stedi_payers` table Harbor already has
- `control_number` — our side's unique claim reference
- `submitted_at`, `status` (`draft|submitted|accepted|rejected|paid|denied`)
- `stedi_response_json` — raw Stedi response for audit
- `era_ids` — TEXT[] of `ehr_payments.id` values that applied to this claim
- `rejection_reason`

**Lifecycle:** `draft` → `submitted` (via Stedi 837) → `accepted`/`rejected` → `paid`/`denied` (when 835 ERA arrives).

### 4. Payment — money received
**Table:** `ehr_payments`
Columns:
- `id`, `practice_id`, `patient_id` (nullable for aggregated ERA)
- `source` — `'patient_stripe' | 'insurance_era' | 'manual_check' | 'manual_cash' | 'manual_card_external' | 'adjustment'`
- `amount_cents`
- `received_at`
- `stripe_payment_intent_id` (for Stripe path)
- `era_json` (for 835 path)
- `note` — free text, e.g. "Check #1234 dated 4/15"
- `applied_to_charge_id` — nullable; null means "credit sitting in patient ledger"

### 5. Invoice — what the patient is asked to pay
**Table:** `ehr_invoices`
Columns:
- `id`, `practice_id`, `patient_id`
- `charge_ids` — TEXT[] of charges on this invoice
- `subtotal_cents`, `total_cents`, `paid_cents`, `status` (`draft|sent|partial|paid|void`)
- `stripe_invoice_id`, `stripe_payment_url` — for portal payment
- `sent_at`, `paid_at`, `due_date`

**Flow:** practice admin selects charges → "Create invoice" → invoice drafted → "Send" generates a Stripe payment link + sends patient an email/SMS → patient pays via portal → webhook updates `paid_cents` and `status`.

### 6. Superbill — itemized receipt for out-of-network self-submission
**Table:** `ehr_superbills`
Columns:
- `id`, `practice_id`, `patient_id`
- `from_date`, `to_date`
- `charges_snapshot_json` — frozen copy of charges at generation time
- `total_cents`, `generated_at`, `generated_by`
- `pdf_url` — nullable; we render HTML on demand and let patient print-to-PDF. If we later store PDFs, this is where the link goes.

**Purpose:** patient pays out-of-pocket but has OON benefits. Therapist gives them this document, patient submits it themselves to their insurance for reimbursement. Huge time-saver for therapists; standard practice in therapy.

---

## Automatic behaviors (the magic that removes admin work)

### "Auto-bill on sign"
Preference: `practices.ui_preferences.features.billing` = true AND `practices.billing_mode` on each patient.
When a therapist signs a note:
1. For each CPT code in the note, create an `ehr_charges` row with status=`pending`.
2. The practice's fee schedule (see `ehr_fee_schedules` below, future) determines `fee_cents` per CPT. Fallback: a practice-level default.
3. Determine `billed_to` from the patient's billing mode + insurance record.
4. Emit an audit event `note.charge_created`.

### "Generate superbill for a date range"
One-click: patient profile → Billing → "Generate superbill" → pick date range → PDF (printable HTML) renders itemized charges with practice info, patient info, tax ID, NPI, CPTs, diagnoses, dates, amounts, and a signature line.

### "Submit batch to insurance"
Billing dashboard → filter charges `status=pending, billed_to=insurance|both` → select → "Submit as claims." Each selected charge becomes an `ehr_claims` row with status=`draft` → 837 EDI assembled → Stedi submission → response stored in `stedi_response_json`.

### "Apply ERA payments"
Weekly cron (to come): poll Stedi for new 835 ERA files → parse → match by `control_number` → insert `ehr_payments` rows → update `ehr_claims.status` and `ehr_charges.status` accordingly. Any unmatched payments land in an "unreconciled" queue for admin review.

### "Send invoice"
Billing dashboard → filter charges `billed_to=patient_self_pay, status=pending` → select → "Bundle into invoice" → Stripe invoice created → email goes to patient with a pay link → portal has a "Pay invoice" entry.

---

## Patient portal surfaces

Under preferences.features.billing AND preferences.features.portal:
- `/portal/invoices` — current balance, sent invoices, "Pay now" buttons
- `/portal/payments` — payment history
- `/portal/superbills` — downloadable superbills issued by the therapist

---

## Therapist-facing surfaces

### Patient-profile `BillingCard`
- Current balance (integer cents, formatted)
- Last 5 charges with CPT, date, amount, status
- Last 3 payments
- Quick actions: **Create charge** · **Send invoice** · **Generate superbill**

### `/dashboard/ehr/billing` (sidebar entry)
- Top stat row: unbilled charges count, aging AR buckets (0–30, 31–60, 61–90, 90+ days), collection rate this quarter, avg days to payment
- Tabs: Unbilled · Submitted · Paid · Denied · Invoices · Payments
- Each tab: filterable table with inline actions
- **Submit batch to insurance** bulk action on Unbilled tab

---

## Stedi integration

Harbor already has the Stedi API key (per `CLAUDE.md` env vars) and a `stedi_payers` table. For Week 5/6 we add:

### `lib/ehr/stedi.ts`
- `verifyEligibility(patient, payer, cpt)` — 270/271 EDI transaction. Called when a new patient is added, and before each claim submission.
- `submitClaim(charge, patient, payer)` — assembles 837 from our data, posts to Stedi, returns control number + response.
- `pollERA()` — called by a cron endpoint to pull new 835 files.

### Claim assembly
837 needs:
- Billing provider: practice NPI, tax ID, address (stored on `practices`)
- Rendering provider: therapist NPI (stored on `therapists` — add column)
- Patient: demographics, member ID, group number
- Diagnoses: from `ehr_charges.note_id`'s icd10_codes
- Service line: CPT, units, fee, date of service, place of service (POS 02 for telehealth, POS 11 for office)

### Sandbox first
Stedi has a sandbox. Every `submitClaim` call in dev mode routes to sandbox. Production toggle lives in `practices.stedi_mode` (`'sandbox' | 'production'`), flipped per-practice by the admin after they've successfully tested their first few claims.

---

## What's NOT in billing v1

These are explicit non-goals for the initial build. They can layer on top cleanly later:

- **Fee schedules per payer** — for now, one fee per CPT per practice. Contract rates per payer is a v2.
- **Payment plans / patient financing** — for now, patients pay invoices in full.
- **Refunds** — manual process via Stripe dashboard; no dedicated UI.
- **Secondary insurance** — for now, primary only. Secondary coordination-of-benefits is a substantial addition.
- **Automated denial appeals** — the system shows denial reasons; admin handles the appeal manually.
- **Patient statements** (monthly mailed/emailed summary of activity) — future.
- **Accounting export** — QuickBooks / Xero sync is future.

---

## Security, audit, compliance

- Every billing read/write writes to `audit_logs` with `resource_type='ehr_billing'` and the right severity. Big actions (claim submission, invoice sent, write-off) are `severity=warn`. Silent reads are `info`.
- Stripe keys already live in Railway for the Harbor subscription product. For patient billing we use the same account but a separate webhook secret (so subscription events and patient-invoice events don't cross wires).
- RLS on every new table mirrors the established `practice_id IN (SELECT FROM users WHERE id = auth.uid())` pattern.
- PHI awareness: we never send diagnosis codes to Stripe. Stripe sees only the CPT code + dollar amount. Diagnosis codes are insurance's problem via Stedi, which is HIPAA-covered.

---

## Implementation order

**This commit (tonight):**
1. Migration for the 4 new tables + columns
2. Auto-create charge when a note is signed (if billable CPT)
3. `BillingCard` on patient profile
4. `/dashboard/ehr/billing` page with top stats + unbilled tab
5. Generate superbill (printable HTML)
6. Manual payment entry (cash/check)

**Next commit (Week 5):**
7. Stripe patient-invoice flow (create → send → pay → reconcile webhook)
8. Eligibility check via Stedi before claim submission
9. 837 claim submission via Stedi (sandbox)
10. 835 ERA polling + reconciliation cron

**Week 6:**
11. Aging AR report, denial tracking
12. Portal /portal/invoices and /portal/superbills
13. Secondary insurance (if any founding members ask)
