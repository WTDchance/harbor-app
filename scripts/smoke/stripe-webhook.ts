// Smoke: Stripe customer.subscription.created event posts cleanly.
//
// Usage: STRIPE_WEBHOOK_SECRET=whsec_… npx tsx scripts/smoke/stripe-webhook.ts

import { baseUrl, ok, fail, stripeSig, require_env } from './_lib'

async function main() {
  const secret = require_env('STRIPE_WEBHOOK_SECRET')
  const url = `${baseUrl()}/api/stripe/webhook`

  const evt = {
    id: `evt_smoke_${Date.now()}`,
    object: 'event',
    type: 'customer.subscription.created',
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: `sub_smoke_${Date.now()}`,
        object: 'subscription',
        customer: 'cus_smoke',
        status: 'active',
        items: { data: [{ price: { id: 'price_smoke' } }] },
      },
    },
  }
  const body = JSON.stringify(evt)
  const { header } = stripeSig(body, secret)

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': header },
    body,
  })
  const text = await res.text()

  if (res.status !== 200) {
    fail(`POST stripe webhook -> ${res.status}`, text.slice(0, 300))
    return
  }
  ok(`POST stripe webhook -> 200`)
}

main().catch((e) => fail('uncaught', e?.message || String(e)))
