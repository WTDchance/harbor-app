// Smoke: SignalWire inbound voice webhook should respond with TwiML that
// dials Retell over wss://api.retellai.com/audio-websocket/<call_id>.
//
// Usage: SIGNALWIRE_SIGNING_KEY=PSK_… npx tsx scripts/smoke/voice-inbound.ts

import { baseUrl, ok, fail, signalwireSig, urlEncodeForm, require_env } from './_lib'

async function main() {
  const signingKey = require_env('SIGNALWIRE_SIGNING_KEY')
  const url = `${baseUrl()}/api/signalwire/inbound-voice`

  // Minimum LaML voice payload SignalWire would post on inbound.
  const form = {
    AccountSid: 'AC' + 'x'.repeat(32),
    CallSid:    'CA' + 'smoke'.padEnd(32, 'x'),
    From:       '+15555550100',
    To:         process.env.STAGING_DID || '+15555550199',
    CallStatus: 'ringing',
    Direction:  'inbound',
  }

  const body = urlEncodeForm(form)
  const sig = signalwireSig(url, form, signingKey)

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-signalwire-signature': sig,
    },
    body,
  })
  const text = await res.text()

  if (res.status !== 200) {
    fail(`POST inbound-voice -> ${res.status}`, text.slice(0, 200))
    return
  }
  ok(`POST inbound-voice -> 200 (${text.length} bytes TwiML)`)

  if (!/<Response/i.test(text)) {
    fail('TwiML root <Response> missing')
    return
  }
  ok('TwiML root present')

  // Either <Connect><Stream> -> Retell wss, or <Dial><Sip> -> retellai.com
  const goodConnect = /<Connect>\s*<Stream[^>]*url="wss:\/\/api\.retellai\.com\//i.test(text)
  const goodDial = /<Dial>\s*<Sip>sip:[^<]+@[^<]*retellai\.com<\/Sip>/i.test(text)
  if (!goodConnect && !goodDial) {
    fail('TwiML does not bridge to Retell (neither Connect/Stream nor Dial/Sip)', text.slice(0, 400))
    return
  }
  ok(`TwiML bridges to Retell (${goodConnect ? 'connect-stream' : 'dial-sip'})`)
}

main().catch((e) => fail('uncaught', e?.message || String(e)))
