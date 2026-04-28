#!/usr/bin/env node
/**
 * Apply supabase/migrations/*.sql to staging RDS via the existing admin
 * endpoint POST /api/admin/run-migration. No DATABASE_URL, no AWS creds —
 * just an admin Cognito session cookie.
 *
 * v2 (Wave 44 fix): all statements from all migration files are bundled
 * into a SINGLE POST request, so the cookie is only authenticated ONCE.
 * Eliminates the mid-run cookie-expiry problem of v1 which made one
 * request per migration file.
 *
 * Usage:
 *   1. Sign in to https://lab.harboroffice.ai/admin in your browser as an admin user.
 *   2. Open DevTools (F12) → Application → Cookies → https://lab.harboroffice.ai
 *   3. Copy the `harbor_access` cookie value.
 *   4. Run:
 *        HARBOR_ADMIN_COOKIE="<paste>" node scripts/apply-migrations-via-admin.mjs
 *      ...or just run the script and paste at the prompt.
 *
 *   Easiest: run the wrapper at scripts/run-migrations.ps1 which prompts
 *   for the cookie and handles the env var for you.
 *
 * Idempotent — already-applied statements report "skipped" rather than
 * failing the run, so it is safe to re-execute.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

let cookie = process.env.HARBOR_ADMIN_COOKIE
if (!cookie) {
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

const trimmed = cookie.trim()
const cookieHeader = trimmed.startsWith('harbor_access=') ? trimmed : `harbor_access=${trimmed}`

const dir = 'supabase/migrations'
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()

console.log(`Bundling all statements from ${files.length} migration files into one request:`)
console.log(files.map((f) => `  - ${f}`).join('\n'))
console.log()

// Collect all statements from all files, preserving order. Track file
// boundaries so we can attribute results back to each file in the report.
const allStatements = []
const fileBoundaries = [] // { file, start, count }

for (const file of files) {
  const sql = readFileSync(join(dir, file), 'utf8')
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')
  const stmts = sql.split(/;\s*\n/).map((s) => s.trim()).filter((s) => s.length > 0)
  fileBoundaries.push({ file, start: allStatements.length, count: stmts.length })
  allStatements.push(...stmts)
}

console.log(`Total statements: ${allStatements.length}. Posting to ${baseUrl}/api/admin/run-migration ...`)
console.log('(Cookie is authenticated once at the start; mid-run expiry is no longer possible.)')
console.log()

const res = await fetch(`${baseUrl}/api/admin/run-migration`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    cookie: cookieHeader,
  },
  body: JSON.stringify({ statements: allStatements }),
})

if (res.status === 401 || res.status === 403) {
  console.error(`FAIL: ${res.status} — cookie expired or not admin. Re-copy harbor_access from DevTools and rerun this script.`)
  process.exit(2)
}

let body
try {
  body = await res.json()
} catch {
  console.error(`FAIL: ${res.status} — non-JSON response from server`)
  process.exit(1)
}

const results = body.results || []
if (results.length !== allStatements.length) {
  console.warn(`Note: server returned ${results.length} results for ${allStatements.length} statements. Reporting may be partial.`)
}

// Tally per-file
let totalOk = 0, totalSkip = 0, totalFail = 0
for (const { file, start, count } of fileBoundaries) {
  let ok = 0, skip = 0, fail = 0
  for (let i = start; i < start + count && i < results.length; i++) {
    const r = results[i]
    if (r.ok) ok++
    else {
      const m = String(r.error || '').toLowerCase()
      if (m.includes('already exists') || m.includes('duplicate')) skip++
      else { fail++; console.log(`    FAIL [${file}]: ${(r.error || '').split('\n')[0]}`) }
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
  console.log('Re-running is safe — already-applied statements will skip cleanly.')
  process.exit(1)
}
process.exit(0)
