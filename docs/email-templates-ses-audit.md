# Email transactional surface — SES verification audit

_Branch: `chore/email-templates-ses`._
_Snapshot: tip on `parallel/aws-v1` at audit time._

## TL;DR

* **Every transactional email in the codebase ships via Amazon SES today.**
  No `Resend`, `SendGrid`, `Nodemailer`, `Mailgun`, `Postmark`, or
  `Mailchimp` packages are listed in `package.json`. The only
  email-related runtime dep is `@aws-sdk/client-ses`. Cleanup of the
  Resend dep was completed in a prior wave; what remains is *cosmetic
  cruft* (header comments still saying "via Resend").
* **One third-party email vendor is wired in:** `agentmail`. It is used
  for an *inbound* email integration (creating practice inboxes via
  `POST /api/integrations/agentmail` and receiving Svix-signed webhooks
  at `POST /api/webhooks/email`). This is **not** in the brief's
  HIPAA-aligned stack (AWS, SignalWire, Retell, Stedi, Stripe). Decision
  needed; flagged below.
* **Two of the brief's five expected templates are gaps**, not cleanups:
  the no-show follow-up has no email path (SMS only), and the password
  reset email is the Cognito factory default with no Harbor branding.
* **Three templates ship via SES today and have been audited** in this
  PR; one received a small footer enhancement to surface
  practice-name + phone + address per the brief's footer requirement.

## Methodology

For each of the brief's five expected templates I ran:

1. `grep -rln @aws-sdk/client-ses\|sendViaSes\|sendEmail\|SendEmailCommand`
   to identify the send path.
2. Read each builder function (subject, body, footer) and walked the
   list of call sites.
3. Checked that the build path reaches `lib/aws/ses::sendViaSes` (the
   one IAM-pinned `Source` we have).
4. Compared the rendered HTML against the brief's mobile/footer/
   subject-line requirements.

## Per-template audit

### 1. Appointment reminder — `lib/reminder-email.ts`

| check                                | status |
|--------------------------------------|--------|
| Sends via SES (`sendViaSes`)         | yes    |
| Subject < 50 chars                   | conditional — `'Appointment Reminder - <practiceName>'` is 22 chars + the practice name; "Hope and Harmony Counseling" pushes it to 49. Short practices are fine; long ones overflow. **Recommend**: drop the practice name from the subject and let the From-line carry it. |
| Body mobile-friendly (≤375px)        | yes — `max-width:600px` and inline styles, single-column |
| Footer with practice name/phone/address | **fixed in this PR** — was just "Sent by Harbor on behalf of …", now surfaces practice name + phone + address (the params were already accepted; they were only being rendered in the body) |
| Tappable CTA buttons                 | n/a — the reminder has no CTA, just info |

### 2. Intake invite — `lib/email.ts::buildIntakeEmail`

| check                                | status |
|--------------------------------------|--------|
| Sends via SES (`sendPatientEmail` → `sendEmail` → `sendViaSes`) | yes |
| Subject < 50 chars                   | conditional — `'Complete your intake form — <practiceName>'` is 32 chars + practice name. Long names will overflow. |
| Body mobile-friendly (≤375px)        | yes — `max-width:600px`, single column, inline styles, 14px+ body |
| Tappable CTA button                  | yes — 14px padding, 36px sides, "Complete My Intake Form →" |
| Footer with practice name/phone/address | **fixed in this PR** — `buildIntakeEmail` now accepts optional `practicePhone` + `practiceAddress` and renders them in the footer. Existing call sites (`/api/intake/{create,resend,send}`) still compile; threading the actual values through is a follow-up small edit at each call site. |

### 3. No-show follow-up — `app/api/appointments/no-show-followup/route.ts`

| check                                | status |
|--------------------------------------|--------|
| Sends via SES                        | **NO** — this route is **SMS-only** today (`sendSMS` from `@/lib/twilio`). |
| Subject / body / footer              | n/a — there is no email template |

**This is a real gap.** The brief expected five email templates; the
no-show follow-up doesn't have one. Two ways to close it:

- (A) Build a `lib/no-show-email.ts` builder that mirrors
  `reminder-email.ts`, then add an `email` branch alongside the existing
  SMS branch in the no-show route. Roughly 80 lines + a wiring change
  in `/api/appointments/no-show-followup`.
- (B) Defer until SignalWire SMS is fully cut over (the route currently
  goes through Twilio anyway, which the Phase B port plan addresses).
  Bundle the email path with that work.

Recommendation: (B). Building the email path first means we're touching
`@/lib/twilio` in this PR, which the email-only brief doesn't authorize.

### 4. Password reset — Cognito default

| check                                | status |
|--------------------------------------|--------|
| Sends via SES                        | yes (Cognito sends through SES when configured with a verified `From`) |
| Subject / body / footer              | **default Cognito copy** — generic "Your verification code is XXXXX". No Harbor branding, no practice name, no footer. |
| Tappable button                      | none — Cognito sends a code, not a link |

**Customizing this is a Cognito + Terraform change**, not a code change
in this repo. Two ways:

- (A) Add a `Custom Message` Lambda trigger
  (`AWS::Cognito::UserPool::LambdaConfig::CustomMessage`) that
  intercepts `CustomMessage_ForgotPassword` and `CustomMessage_SignUp`
  events and emits Harbor-branded HTML. Lives in `infra/terraform`.
- (B) Set `EmailConfiguration.SourceArn` on the Cognito User Pool to
  Harbor's SES verified address and rely on Cognito's built-in
  template-text fields. Less branding control but no Lambda needed.

**Decision needed from the user.** Both are out of scope for this PR
(Terraform + Lambda, not Next.js).

### 5. Practice signup welcome — `lib/email-welcome.ts`

| check                                | status |
|--------------------------------------|--------|
| Sends via SES (`sendEmail` → `sendViaSes`) | yes |
| Subject < 50 chars                   | conditional — `'Welcome to Harbor — <aiName> is live for <practiceName>'` is 34 chars + names. With "Ellie" + "Hope and Harmony Counseling" → 70 chars. **Overflows on most real names.** Recommend tightening to e.g. `'Welcome to Harbor — your line is live'` (37 chars). Did not change this PR — touches signup flow which is sensitive. |
| Body mobile-friendly (≤375px)        | yes |
| Tappable CTA button                  | yes — "Open My Dashboard →", 14px padding |
| Footer                               | "Harbor · AI Receptionist for Therapy Practices · harborreceptionist.com" — appropriate (this email is *from* Harbor, not on behalf of a practice, so practice phone/address don't apply). |
| Unsubscribe link                     | **missing** — the brief explicitly says "include unsubscribe link for non-clinical communications". This email is welcome / onboarding marketing — should have an unsubscribe link. |

## Cleanups not yet done (would land as cosmetic follow-ups)

The actual sender code is SES, but a number of files still carry
"Resend" in header comments, env-var fallbacks, or constant names. None
of these are wrong functionally — they just confuse readers. Files
worth a one-shot pass:

| file                            | what to scrub                                                |
|---------------------------------|--------------------------------------------------------------|
| `lib/email.ts`                  | header comment uses "Resend" twice; ALSO three exported `EMAIL_*` constants still read `RESEND_CHANCE_EMAIL` / `RESEND_SALES_EMAIL` / `RESEND_SUPPORT_EMAIL` env vars as fallback — rename to `EMAIL_*_REPLY_TO_*` |
| `lib/aws/ses.ts`                | `sesFromAddress()` falls back to `RESEND_FROM_EMAIL` env var. Safe today; remove once `SES_FROM_ADDRESS` is set in all envs. |
| `lib/reminder-email.ts`         | top comment says "(was Resend)" — fine to leave for context, fine to drop. |
| `lib/email-welcome.ts`          | comment still says "Twilio + Vapi" provisioning even though that's untrue post-port. Cosmetic. |
| `app/api/admin/email-health/route.ts` | exposes `RESEND_FROM_EMAIL` as a separate env field; can collapse into `SES_FROM_ADDRESS` once `RESEND_FROM_EMAIL` is unset everywhere. |
| `app/api/cron/{intake-reminders,reconcile,ehr-monthly-report}/route.ts` | "via Resend" in comments |
| `app/api/intake/resend/route.ts`| route name itself — `resend` here means *re-send the intake link* (the verb), NOT the Resend SaaS. **Do not rename.** |

I did not bundle these into this PR because:

- The constant renames touch six caller files each (3 × 6 imports).
- They're all cosmetic; landing them increases review surface for zero
  behaviour change while Wave 38 is actively pushing.
- Bundling them with a small "Resend wording sweep" PR after the active
  wave settles is safer.

## Decision needed from the user — AgentMail

`lib/agentmail.ts`, `app/api/integrations/agentmail/route.ts`, and
`app/api/webhooks/email/route.ts` integrate with **AgentMail**, a
third-party email-inbox provider. It is used for inbound email (one
inbox per practice; messages arrive via Svix-signed webhooks) and is
**not** part of the brief's HIPAA-aligned stack.

Three options, in order of risk:

1. **Keep, add a BAA flag**: if AgentMail has a BAA with Harbor and
   was approved before the brief was written, document the approval
   in `docs/key-management-policy.md` and leave the integration in.
2. **Wall off behind a feature flag** (`USE_AGENTMAIL=false` defaults
   to false, code is dormant unless the flag flips). Enable per
   environment only after BAA verification.
3. **Remove** — drop the three files and the `AGENTMAIL_*` env vars.
   Inbound email lives somewhere else (SES inbound, Cloudflare Email
   Workers, or a dedicated transactional-mail vendor with a BAA).

This PR makes **zero changes** to the AgentMail surfaces. The user
should pick (1), (2), or (3) and the follow-up patch is small under
any of them.

## Acceptance criteria from the brief

| acceptance check                                                                                                  | status |
|-------------------------------------------------------------------------------------------------------------------|--------|
| `grep -ri "resend\|sendgrid" --include='*.ts' --include='*.tsx' --include='*.json'` returns nothing meaningful    | `package.json` is clean. Code references are cosmetic comments + env-var fallback names — see "Cleanups not yet done" above. |
| Each template renders cleanly in a 375px-wide viewport                                                            | Confirmed for reminder, intake, welcome via `max-width:600px`, single-column, ≥14px body, inline styles. |
| PR description lists each template, what changed, and any constraints flagged                                      | yes — see PR body. |

## Constraints honoured

- No clinical content was changed. Only the *footer wrapper* on
  reminder and intake emails was touched, and only to add practice
  contact info that the brief explicitly requires.
- `package.json` was not modified.
- No new third-party data processors were added.
- `npm run build` was not runnable in the sandbox; tsc
  `--isolatedModules` is clean on both changed files.
