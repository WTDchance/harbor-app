# Smoke tests — Harbor staging

These scripts hit the staging API directly (`STAGING_BASE_URL` env, defaults to
`https://lab.harboroffice.ai`). They're meant to be run after a deploy or on a
schedule to confirm the carrier and billing surfaces still 200.

**Never point these at production.** Each script will refuse to run if
`STAGING_BASE_URL` looks like the prod hostname (`harborreceptionist.com`).

## Setup

```bash
npm install                                     # uses repo deps
export STAGING_BASE_URL=https://lab.harboroffice.ai
export STAGING_PRACTICE_ID=<seed practice uuid> # for signup-flow.ts
export STAGING_PATIENT_ID=<seed patient uuid>   # for ai-soap-draft.ts
export SIGNALWIRE_SIGNING_KEY=PSK_…             # the LaML signing key
export RETELL_API_KEY=<staging retell key>      # webhook HMAC key
export STRIPE_WEBHOOK_SECRET=whsec_…            # subscription webhook secret
```

## Running

```bash
npx tsx scripts/smoke/signup-flow.ts
npx tsx scripts/smoke/voice-inbound.ts
npx tsx scripts/smoke/retell-webhook.ts
npx tsx scripts/smoke/stripe-webhook.ts
npx tsx scripts/smoke/ai-soap-draft.ts
```

Or all at once:

```bash
for f in scripts/smoke/*.ts; do
  echo "── $f"
  npx tsx "$f" || echo "FAIL $f"
done
```

## What each one does

| script              | endpoint                               | asserts                                   |
|---------------------|----------------------------------------|-------------------------------------------|
| signup-flow         | `POST /api/signup`                     | provisioning lambda chain returns 2xx     |
| voice-inbound       | `POST /api/signalwire/inbound-voice`   | TwiML `<Connect><Stream>` → Retell wss    |
| retell-webhook      | `POST /api/retell/webhook` (call_ended)| 2xx + call_logs row created (verified out-of-band) |
| stripe-webhook      | `POST /api/stripe/webhook`             | 2xx on `customer.subscription.created`    |
| ai-soap-draft       | `POST /api/ehr/notes/draft`            | non-empty SOAP-shaped JSON                |

## Conventions

- Scripts exit 0 on green, 1 on red. `process.exitCode = 1` so logs flush.
- Print one line per assertion: `✓ <thing>` or `✗ <thing>`. No JSON dumps unless
  `DEBUG=1`.
- All HMAC signing happens in-process; no shelling out to other services.
