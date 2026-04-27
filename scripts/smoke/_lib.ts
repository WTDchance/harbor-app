// Shared helpers for smoke scripts. Stays small + dependency-free.

import { createHmac } from 'node:crypto'

export function baseUrl(): string {
  const url = process.env.STAGING_BASE_URL || 'https://lab.harboroffice.ai'
  if (/harborreceptionist\.com/i.test(url)) {
    throw new Error('refusing to run smoke tests against production')
  }
  return url.replace(/\/$/, '')
}

export function ok(label: string) {
  console.log(`✓ ${label}`)
}

export function fail(label: string, why?: unknown) {
  process.exitCode = 1
  console.log(`✗ ${label}${why ? ` -- ${typeof why === 'string' ? why : JSON.stringify(why).slice(0, 300)}` : ''}`)
}

/** Stripe-style HMAC-SHA256(`${ts}.${rawBody}`, whsec). Header: `t=ts,v1=hex`. */
export function stripeSig(rawBody: string, secret: string): { header: string; ts: number } {
  const ts = Math.floor(Date.now() / 1000)
  const sig = createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest('hex')
  return { header: `t=${ts},v1=${sig}`, ts }
}

/**
 * SignalWire/Twilio LaML signature. Concat URL + sorted form key/value pairs,
 * HMAC-SHA1 with the LaML signing key, base64.
 */
export function signalwireSig(
  rawUrl: string,
  formParams: Record<string, string>,
  signingKey: string,
): string {
  let buf = rawUrl
  for (const k of Object.keys(formParams).sort()) buf += k + (formParams[k] ?? '')
  return createHmac('sha1', signingKey).update(buf).digest('base64')
}

/** Retell webhook signature: HMAC-SHA256(rawBody+ts, apiKey). Header: `v=ts,d=hex`. */
export function retellSig(rawBody: string, apiKey: string): string {
  const ts = Date.now().toString()
  const d = createHmac('sha256', apiKey).update(rawBody + ts).digest('hex')
  return `v=${ts},d=${d}`
}

export function urlEncodeForm(params: Record<string, string>): string {
  return Object.entries(params).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
}

export function require_env(name: string): string {
  const v = process.env[name]
  if (!v) {
    console.error(`error: ${name} env var required`)
    process.exit(1)
  }
  return v
}
