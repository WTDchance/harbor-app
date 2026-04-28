#!/usr/bin/env node
/**
 * Apply supabase/migrations/*.sql to staging RDS via the existing admin
 * endpoint POST /api/admin/run-migration. No DATABASE_URL, no AWS creds —
 * just an admin Cognito session cookie.
 *
 * Usage:
 *   1. Sign in to https://lab.harboroffice.ai/admin in your browser as an admin user.
 *   2. Open DevTools (F12) → Application → Cookies → https://lab.harboroffice.ai
 *   3. Copy the `harbor_access` cookie value (long JWT-looking string).
 *   4. Run:
 *        HARBOR_ADMIN_COOKIE="<paste the value here>" node scripts/apply-migrations-via-admin.mjs
 *
 *   Optional: HARBOR_BASE_URL=https://other.host node scripts/...  (defaults to staging)
 *
 * Idempotent — the admin endpoint accepts each statement individually and
 * tolerates "already exists" errors per-statement (logged but not fatal).
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

let cookie = process.env.HARBOR_ADMIN_COOKIE
if (!cookie) {
  // Interactive fallback — prompt the user to paste the cookie.
  const readline = await import('node:readline')
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false })
  process.stdout.write('Paste your harbor_access cookie value, then press Enter:\n> ')
  cookie = await new Promise((resolve) => rl.once('line', (line) => { rl.close(); resolve(line) }))
  if (!cookie || !cookie.trim()) {
    console.error('Abort: no cookie provided.')
    process.exit(2)
  }
}

const baseUrl = (process.env.HARBOR_BASE_URL || 'https://lab.harboroffice.ai').replace(/\/$/, '')
if (/harborreceptionist\.com/i.test(baseUrl)) {
  console.error('Abort: refuse to run against production hostname.')
  process.exit(2)
}

const dir = 'supabase/migrations'
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()

console.log(`Applying ${files.length} migrations to ${baseUrl} via /api/admin/run-migration:`)
console.log(files.map((f) => `  - ${f}`).join('\n'))
console.log()

// Prepend harbor_access= unless the user already included it. JWTs commonly
// end with '=' base64 padding, so a naive cookie.includes('=') check misfires.
const trimmed = cookie.trim()
const cookieHeader = trimmed.startsWith('harbor_access=') ? trimmed : `harbor_access=${trimmed}`

let totalOk = 0, totalSkip = 0, totalFail = 0

for (const file of files) {
  const sql = readFileSync(join(dir, file), 'utf8')
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')

  const statements = sql
    .split(/;\s*\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

  if (statements.length === 0) {
    console.log(`  SKIP ${file}: no statements`)
    continue
  }

  const res = await fetch(`${baseUrl}/api/admin/run-migration`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: cookieHeader,
    },
    body: JSON.stringify({ statements }),
  })

  if (res.status === 401 || res.status === 403) {
    console.error(`  FAIL ${file}: ${res.status} — cookie expired or not admin. Re-copy harbor_access and retry.`)
    process.exit(2)
  }

  let body
  try {
    body = await res.json()
  } catch {
    console.error(`  FAIL ${file}: ${res.status} — non-JSON response`)
    totalFail += statements.length
    continue
  }

  let ok = 0, skip = 0, fail = 0
  for (const r of body.results || []) {
    if (r.ok) ok++
    else {
      const msg = String(r.error || '').toLowerCase()
      if (msg.includes('already exists') || msg.includes('duplicate')) skip++
      else { fail++; console.log(`    FAIL: ${(r.error || '').split('\n')[0]}`) }
    }
  }
  totalOk += ok
  totalSkip += skip
  totalFail += fail
  const status = fail > 0 ? 'WARN' : 'OK'
  console.log(`  ${status} ${file}: ${ok} applied, ${skip} skipped, ${fail} failed`)
}

console.log(`\n=== Summary: ${totalOk} applied, ${totalSkip} skipped, ${totalFail} failed ===`)
if (totalFail > 0) {
  console.log('Re-running is safe — already-applied statements skip cleanly.')
  process.exit(1)
}
process.exit(0)
