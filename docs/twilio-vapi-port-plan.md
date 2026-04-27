# Twilio + Vapi → SignalWire + Retell port plan

_Status: scoped 2026-04-26. Active port required before T1.2 close-out._

## Why this isn't done yet

The Wave-32b commit (`c6547fb`) swapped the **uptime probes** to Retell/SignalWire,
but the underlying provisioning + SMS + voice paths still depend on Twilio
through `lib/twilio-provision.ts` and `lib/twilio.ts`. The HIPAA-stack rule
("Twilio/Vapi are out") is a *target state*, not the *current state*.

Removing the Twilio surface without porting first would break, in roughly
order of patient impact:

1. **Crisis SMS** — `app/api/crisis/route.ts` sends warm-handoff messages.
2. **Appointment reminders** — `app/api/reminders/send/route.ts` (and the
   nested `/send/send` shim).
3. **No-show / prep messages** — `app/api/appointments/no-show-followup`,
   `app/api/appointments/prep-messages`.
4. **Inbound SMS handling** — `app/api/sms/inbound/route.ts` (+ webhooks/sms).
5. **Phone-number search/buy** during signup — `app/api/phone-numbers/search`,
   `app/api/twilio/available-numbers`.
6. **Admin maintenance endpoints** — `phone-diag`, `reprovision`,
   `repair-practice`, `attach-vapi`, `twilio-a2p`, `update-practice`,
   `test-sms`, `signups`.

`lib/twilio-provision.ts` is imported by 12 files; `lib/twilio.ts` by several
more. There is **no `lib/signalwire.ts` provisioning equivalent yet** — only
the inbound webhook validator (`lib/aws/signalwire.ts`).

## Port plan (proposed)

### Phase A — Build the SignalWire equivalents (no removal yet)

- `lib/aws/signalwire-provision.ts` — search-available-numbers, purchase,
  release, set-voice-url, set-sms-url. Uses SIGNALWIRE_PROJECT_ID +
  SIGNALWIRE_TOKEN basic-auth via the LaML REST API.
- `lib/aws/signalwire-sms.ts` — send-sms (replaces `lib/twilio.ts::sendSms`).
- Confirm Retell agent already covers everything `lib/vapi-provision.ts` did.

### Phase B — Port one caller at a time

Order by patient-impact / blast radius:

1. **Inbound SMS** (`app/api/sms/inbound`) — already half-on-SignalWire (the
   `app/api/signalwire/inbound-sms` route handles it); finish the consolidation
   so the legacy path is a thin redirect or is deleted.
2. **Outbound reminder SMS** (`app/api/reminders/send`) — point at
   `signalwire-sms.ts`.
3. **Crisis SMS** — same.
4. **No-show / prep messages** — same.
5. **Phone-number search/purchase** — point at `signalwire-provision.ts`. This
   touches signup; verify the provisioning lambda chain end-to-end.
6. **Admin maintenance endpoints** — port `phone-diag`, `reprovision`, etc.

### Phase C — Remove the legacy surface

Once *every* caller is ported and a smoke run is clean against staging:

- Delete `lib/twilio-provision.ts`, `lib/twilio.ts`, `lib/vapi-provision.ts`,
  `app/api/twilio/*`, `app/api/vapi/*`, `app/api/admin/attach-vapi`,
  `app/api/admin/twilio-a2p`, `app/api/admin/phone-diag` (rebuild as
  `signalwire-diag`), and any `lib/events.ts` Vapi event helpers.
- `npm uninstall twilio` (it is still a runtime dep — `package.json` line for
  `"twilio": "^4.10.0"` removes only after Phase B is complete).
- Drop SSM params/IAM for any Twilio/Vapi credentials still wired (none
  observed in `infra/terraform/secrets.tf` — Wave 27b already cleaned that).

### What the user can do tonight

Nothing — this requires AWS staging access for end-to-end smoke testing after
each port, which the briefing flagged is gated on the user's hands. The plan
itself is the deliverable for tonight; Phases A/B/C are a multi-PR effort.

## Why we did not do a partial scrub

A partial scrub (delete only the unimported files) would leave `package.json`
still depending on `twilio`, `app/api/vapi/webhook` still receiving carrier
traffic until DNS/route changes land, and 12 active routes still importing
the legacy lib. The first deploy with a half-scrub would either be a no-op
(no win) or cause a runtime crash (large risk for "true patients tomorrow").

A full port behind a feature flag (`USE_SIGNALWIRE_PROVISION=true`) is the
safe shape; that is the recommended next session of work.
