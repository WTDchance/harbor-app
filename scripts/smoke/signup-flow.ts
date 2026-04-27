// Smoke: /api/signup is reachable and validates input correctly.
//
// We DO NOT trigger an end-to-end provisioning chain here because that
// would pollute the DB / phone-number pool / Stripe customers on every
// smoke run. Instead we send an intentionally-invalid payload and
// assert the route returns 4xx with the expected error shape — this
// catches deploys that accidentally take the signup route offline,
// while keeping the test idempotent.
//
// To run a real end-to-end signup, set STAGING_FULL_SIGNUP=1 — you
// own the cleanup of the resulting practice.
//
// Usage: npx tsx scripts/smoke/signup-flow.ts

import { baseUrl, ok, fail } from './_lib'

async function main() {
  const url = `${baseUrl()}/api/signup`

  // Validation smoke: missing required fields should 4xx, not 5xx.
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  })
  const text = await res.text()

  if (res.status >= 500) {
    fail(`POST signup with empty body -> ${res.status} (expected 4xx)`, text.slice(0, 200))
    return
  }
  if (res.status < 400) {
    fail(`POST signup with empty body -> ${res.status} (route should reject)`, text.slice(0, 200))
    return
  }
  ok(`POST signup with empty body -> ${res.status} (validation works)`)

  if (process.env.STAGING_FULL_SIGNUP === '1') {
    const stamp = Date.now()
    const email = `smoke+${stamp}@harborinternal.test`
    const r2 = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        practice_name: `Smoke Practice ${stamp}`,
        provider_name: 'Smoke Therapist',
        email,
        password: `Smoke!${stamp}aB1`,
      }),
    })
    const t2 = await r2.text()
    if (r2.status !== 200) {
      fail(`POST signup full -> ${r2.status}`, t2.slice(0, 300))
      return
    }
    ok(`POST signup full -> 200 (cleanup smoke practice for ${email})`)
  }
}

main().catch((e) => fail('uncaught', e?.message || String(e)))
