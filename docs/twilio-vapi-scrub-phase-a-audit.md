# Twilio/Vapi scrub — Phase A audit (no deletions executed)

_Branch: `chore/twilio-scrub-phase-a`._
_Author: paired follow-up to `docs/twilio-vapi-port-plan.md`._
_Snapshot: tip `6d7161c` on `parallel/aws-v1`._

## TL;DR

Phase A as scoped ("mechanical removal of dead Twilio / Vapi code paths
that no longer have a live caller") **yields zero deletions under the
current state of the codebase.** Every Twilio/Vapi file falls into one
of four categories, and none is *dead-only*:

1. **Active importee** — depended on by a live route in the explicitly-
   deferred Phase B set (crisis SMS, reminders, no-show/prep,
   inbound SMS). Removing it would break those routes today.
2. **Deliberate deprecation shim** — file kept on purpose so stale
   third-party config that still POSTs to the old URL gets a graceful
   2xx + audit row instead of a 404. Comment in the file says so.
3. **Phase-B port target** — used by an active route that needs a
   SignalWire/Retell port before the Twilio surface can come out.
4. **Phase-C cascade target** — admin/maintenance route that the port
   plan lists for deletion *after* the SignalWire equivalent ships,
   not before.

The original Phase A scope assumed there was a category-0 ("imported by
nothing, not a route, not a shim, not a port target") set. The audit
below shows that set is empty.

## Methodology

Three passes, performed against the freshest tip of `parallel/aws-v1`:

1. **File inventory** — `find` + grep for any `.ts/.tsx/.json/.js/.mjs`
   under the repo (excluding `node_modules`, `.next`, `.git`) whose
   path contains `twilio` or `vapi`. **10 files.**
2. **Import graph** — for every match, `grep -rln` the rest of the tree
   for `from '...lib/twilio*'`, `from 'twilio'`, `from '...lib/vapi*'`,
   etc. Recorded callers per file.
3. **Behavioural read** — opened every file and read the header comment
   to distinguish "deprecation shim by design" from "stale residue".
   Cross-referenced findings with `docs/twilio-vapi-port-plan.md`,
   `docs/hipaa-audit-matrix.md`, and the in-file comments.

## Per-file verdict

| file                                          | callers? | category                              | Phase-A delete?           |
|-----------------------------------------------|----------|---------------------------------------|---------------------------|
| `app/api/admin/attach-vapi/route.ts`          | route    | Phase-C cascade (port plan ¶C)        | NO — see ATTACH-VAPI      |
| `app/api/admin/twilio-a2p/route.ts`           | route    | Active A2P 10DLC compliance tooling   | NO — see A2P              |
| `app/api/admin/phone-diag/route.ts`           | route    | Phase-C cascade ("rebuild as signalwire-diag") | NO — see PHONE-DIAG |
| `app/api/twilio/available-numbers/route.ts`   | route    | Phase-B port target (signup search)   | NO                        |
| `app/api/twilio/forward/route.ts`             | route    | **Deliberate deprecation shim**       | NO — file says so         |
| `app/api/twilio/sms-webhook/route.ts`         | route    | **Deliberate deprecation shim**       | NO — file says so         |
| `app/api/twilio/status/route.ts`              | route    | **Active source-of-truth observer**   | NO — file says so         |
| `app/api/vapi/webhook/route.ts`               | route    | Active carrier traffic (port plan ¶C) | NO                        |
| `lib/twilio-provision.ts`                     | 8+ live  | Phase-B port target                   | NO                        |
| `lib/twilio.ts`                               | 7+ live  | Phase-B port target                   | NO                        |
| `lib/vapi-provision.ts`                       | 2 live   | Phase-C cascade                       | NO                        |

## Detailed findings

### `lib/twilio.ts` — 8 exported helpers, **all live-imported**

```
sendSMS                          — used by /api/crisis, /api/reminders/send,
                                   /api/appointments/no-show-followup,
                                   /api/appointments/prep-messages,
                                   /api/sms/inbound, /api/vapi/webhook,
                                   lib/reminders.ts
sendSMSFromNumber                — same callers as sendSMS
listPhoneNumbers                 — /api/admin/phone-diag,
                                   /api/admin/reprovision
getPhoneNumberWebhook            — /api/admin/reprovision
updatePhoneNumberWebhook         — /api/admin/reprovision
generateSMSResponse              — /api/sms/inbound
formatPhoneNumber                — multiple admin pages
extractPhoneFromTwilioPayload    — /api/sms/inbound
```

Crisis SMS, reminders, no-show, prep, and inbound SMS are explicitly
called out in the brief as "Phase B and the user will sign off
separately — DO NOT touch these in Phase A". Therefore `lib/twilio.ts`
must stay.

### `lib/twilio-provision.ts` — 4 exported helpers, **all live**

```
purchaseTwilioNumber, releaseTwilioNumber,
attachNumberToMessagingService, PurchasedNumber (interface)
```

The port plan flags this file as the prerequisite for Phase A of the
*plan's* phasing (build `lib/aws/signalwire-provision.ts` first, then
swap callers). Until then it's live.

### `lib/vapi-provision.ts` — 4 exported helpers, **2 live importers**

```
createVapiAssistant, linkVapiPhoneNumber, deleteVapiAssistant,
PracticeContext (interface)
```

Imported by `app/api/admin/attach-vapi/route.ts` and
`app/api/admin/reprovision/route.ts`. Deleting `lib/vapi-provision.ts`
would require deleting both — and `reprovision` is not yet flagged for
removal in the port plan (it's an active maintenance tool used to
re-provision a practice from scratch). Decision deferred to the user.

### ATTACH-VAPI — `app/api/admin/attach-vapi/route.ts`

Header comment: "Used to retrofit Vapi onto practices created outside
the normal signup flow (e.g. the internal Harbor Demo line)."

Bound by `CRON_SECRET` bearer auth, so it has no static caller in the
repo — only manual cron / curl. The matrix flagged it as "slated for
deletion (T1.2 plan)" but the port plan groups it with other Phase-C
admin routes that depend on `lib/vapi-provision.ts`.

**User decision needed:**
- (A) Keep until Vapi → Retell migration is fully cut over.
- (B) Delete now, accepting that any future "re-attach Vapi to a
  retrofitted practice" call would have to be a hand-rolled curl to
  `https://api.vapi.ai` directly.

Recommendation: keep until Phase B is done. The cost of keeping is
~150 lines of admin-only code; the cost of premature deletion is
losing the ability to fix a wedged practice during the cutover.

### A2P — `app/api/admin/twilio-a2p/route.ts`

Header comment: "Admin Twilio A2P bind/diagnose endpoint... Lists
Messaging Services... attaches the given phone-number SID to the given
Messaging Service pool... Required after a campaign approval attaches
the campaign to a different MS than where the numbers currently live."

This is **active A2P 10DLC compliance tooling**. Twilio's A2P
registration is the legal/regulatory wrapper for SMS, and the move/
attach actions in this file are how Harbor manages a campaign approval
in production. The matrix called it "Same as above (legacy Twilio)"
but the file content suggests it's still genuinely useful while *any*
Twilio phone number is in service.

**User decision needed:**
- (A) Keep through the Twilio→SignalWire SMS port — A2P is per-carrier,
  so SignalWire numbers will need their own (different) compliance
  tooling, but the Twilio numbers in production today still need this.
- (B) Delete only after every practice's SMS traffic has migrated off
  Twilio (Phase B item 2 + 3, plus dialing-around for crisis/no-show).

Recommendation: keep until Phase B SMS port is complete and the last
Twilio number is released.

### PHONE-DIAG — `app/api/admin/phone-diag/route.ts`

Header comment: "Diagnostic endpoint for tracing a phone number across
Harbor's stack." Searches across `practices`, `call_logs`, `patients`,
`auth.users`, and the Twilio account. Useful when a number "goes
missing" between provisioning, billing, and call routing.

Port plan: "rebuild as `signalwire-diag`". Not deletable without
replacement — this is a real operational tool.

**User decision needed:** none for now. Waiting on `signalwire-diag`.

### `/api/twilio/forward/route.ts`, `/api/twilio/sms-webhook/route.ts`

Both of these contain a comment block of the form:
"This file is kept (rather than deleted) so any stale Twilio dashboard
config that still POSTs here surfaces a graceful failure rather than a
404, and so [audit] trail shows the deprecation rather than missing
routes."

These are **load-bearing deprecation shims**. Deleting them turns any
forgotten Twilio webhook config into a 404 storm without an audit
trail. Recommendation: keep through Phase C *plus* one quarter, then
remove once `audit_logs` shows zero `twilio.forward.deprecated_hit` /
`twilio.sms_webhook.deprecated_hit` rows for 90 days.

### `/api/twilio/status/route.ts` — **NOT a deprecation shim**

Comment: "This gives us a source of truth for inbound calls that's
INDEPENDENT of Vapi — so if Vapi silently drops a call or the
end-of-call webhook never fires, we still know the call happened."

Wired up in Twilio dashboard at "Call status changes". Genuinely
active. **Cannot remove until inbound voice is fully off Twilio.**

### `/api/vapi/webhook/route.ts`

Port plan: "still receiving carrier traffic until DNS/route changes
land". Active. Phase C, not Phase A.

### Other landmines worth noting

* `package.json` still depends on `twilio` (`^4.10.0`). Cannot be
  removed until `lib/twilio.ts`, `lib/twilio-provision.ts`, and
  `phone-diag` are all gone. Three Phase-B/C dominos away.
* `lib/events.ts` declares `'twilio' | 'vapi'` as `eventType.source`
  enum values. Cannot be removed without a DB migration on
  `events.source` if any rows reference those strings.
* `infra/sql/schema.sql` has `vapi_*` and `twilio_*` columns. These
  outlive the code by design (data migration is a separate
  conversation; you don't drop columns on a running EHR cluster).
* `scripts/seed-ehr-sample-call.mjs` uses `vapi_call_id` as a constant
  literal in a dev-only seed script. Harmless; the column may stay
  named `vapi_call_id` for years even after the carrier swap.

## Recommended path forward

The brief's strict guardrail ("don't touch crisis/reminders/no-show/
inbound SMS — Phase B") combined with the port plan's "no partial
scrub" stance leaves Phase A with no in-scope work. The most useful
Phase-A-shaped PR is **this audit document** plus three explicit user
decisions (above) that will free up the cleanup once Phase B/C ships:

1. **ATTACH-VAPI** — delete now, or keep until cutover?
2. **TWILIO-A2P** — delete after Twilio numbers are zero, or keep as
   permanent SMS-compliance tool template (and rename
   `twilio-a2p` → `sms-a2p` to make it carrier-neutral)?
3. **DEPRECATION-SHIM SUNSET** — keep `/api/twilio/forward` and
   `/api/twilio/sms-webhook` for one quarter past last hit, or sunset
   on a fixed calendar date?

If any of those decisions land in this branch's lifetime, the
deletes become 5-line commits and ride on top of this PR.

## What would unblock a real Phase-A scrub

Phase A as written would yield real deletions only after:

1. `lib/aws/signalwire-provision.ts` exists and exports the
   `purchase / release / setVoiceUrl / setSmsUrl` shape that
   `lib/twilio-provision.ts` exports today.
2. `lib/aws/signalwire-sms.ts` exists and exports the same shape as
   `lib/twilio.ts::sendSMS`.
3. The seven callers of `lib/twilio.ts` (crisis, reminders, no-show,
   prep, sms-inbound, vapi webhook, lib/reminders) have flipped to
   the SignalWire helpers behind a `USE_SIGNALWIRE_PROVISION` flag,
   the flag has been on in staging for ≥1 week with zero error
   delta, and production has flipped.
4. Twilio numbers have been released back to Twilio's pool and the
   account has zero active phone-number rows. (`lib/aws/signalwire-
   provision.ts::releaseSignalWireNumber` will need to do the
   reverse.)

At that point, the sequence in `docs/twilio-vapi-port-plan.md` Phase C
becomes a single 50-file delete commit + `npm uninstall twilio`. Not
this PR.
