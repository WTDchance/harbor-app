// Smoke: AI SOAP draft endpoint returns valid JSON for a fake transcript.
// Requires an authenticated Cognito session — set STAGING_AUTH_COOKIE to
// the cookie string from a logged-in browser session against staging.
//
// Usage: STAGING_AUTH_COOKIE='hb-session=…' npx tsx scripts/smoke/ai-soap-draft.ts

import { baseUrl, ok, fail } from './_lib'

async function main() {
  const cookie = process.env.STAGING_AUTH_COOKIE
  const patientId = process.env.STAGING_PATIENT_ID
  if (!cookie) {
    console.log('skip: STAGING_AUTH_COOKIE not set (this endpoint needs an active session)')
    return
  }
  if (!patientId) {
    console.log('skip: STAGING_PATIENT_ID not set')
    return
  }

  const url = `${baseUrl()}/api/ehr/notes/draft-from-brief`
  const body = JSON.stringify({
    patient_id: patientId,
    note_format: 'soap',
    brief: 'Patient reports trouble sleeping for 3 weeks. Mood low. Discussed sleep hygiene + grounding exercises. Plan: revisit next session, log sleep diary.',
  })

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body,
  })
  const text = await res.text()

  if (res.status !== 200) {
    fail(`POST draft-from-brief -> ${res.status}`, text.slice(0, 300))
    return
  }
  ok(`POST draft-from-brief -> 200`)

  let parsed: any
  try { parsed = JSON.parse(text) } catch {
    fail('response is not valid JSON', text.slice(0, 200))
    return
  }
  const draft = parsed?.draft || parsed
  const hasShape = draft && (draft.subjective || draft.body || draft.assessment || draft.plan)
  if (!hasShape) {
    fail('draft missing subjective/body/assessment/plan', text.slice(0, 400))
    return
  }
  ok(`draft has SOAP-shaped content (${Object.keys(draft).join(',')})`)
}

main().catch((e) => fail('uncaught', e?.message || String(e)))
