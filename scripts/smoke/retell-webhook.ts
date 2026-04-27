// Smoke: Retell call_ended webhook persists a call_logs row.
//
// Usage: RETELL_API_KEY=… npx tsx scripts/smoke/retell-webhook.ts

import { baseUrl, ok, fail, retellSig, require_env } from './_lib'

async function main() {
  const apiKey = require_env('RETELL_API_KEY')
  const url = `${baseUrl()}/api/retell/webhook`

  const callId = `smoke_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const payload = {
    event: 'call_ended',
    call: {
      call_id: callId,
      agent_id: process.env.RETELL_AGENT_ID || 'agent_smoke',
      from_number: '+15555550100',
      to_number: process.env.STAGING_DID || '+15555550199',
      direction: 'inbound',
      start_timestamp: Date.now() - 60_000,
      end_timestamp: Date.now(),
      transcript: 'caller: hi\nagent: hello, this is the front desk',
    },
  }
  const body = JSON.stringify(payload)
  const sig = retellSig(body, apiKey)

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-retell-signature': sig },
    body,
  })
  const text = await res.text()

  if (res.status !== 200 && res.status !== 202) {
    fail(`POST retell webhook -> ${res.status}`, text.slice(0, 200))
    return
  }
  ok(`POST retell webhook -> ${res.status}`)
  ok(`call_id ${callId} dispatched (verify call_logs out-of-band)`)
}

main().catch((e) => fail('uncaught', e?.message || String(e)))
