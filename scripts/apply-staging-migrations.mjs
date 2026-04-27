#!/usr/bin/env node
/**
 * Apply supabase/migrations/*.sql onto a Postgres DB in alphabetical order.
 * Idempotent: tolerates "already exists" / "duplicate" errors.
 *
 * Usage:
 *   DATABASE_URL=postgres://user:pass@host:5432/dbname \
 *     node scripts/apply-staging-migrations.mjs
 *
 *   # Or against AWS RDS staging:
 *   DATABASE_URL=postgres://harbor_app:$(aws secretsmanager get-secret-value --secret-id harbor-staging-db-password --query SecretString --output text)@harbor-staging-pg.cepm2agwuk3f.us-east-1.rds.amazonaws.com:5432/harbor \
 *     node scripts/apply-staging-migrations.mjs
 *
 * Refuses to run if DATABASE_URL points at a production-looking host.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const URL = process.env.DATABASE_URL
if (!URL) {
  console.error('Abort: DATABASE_URL env var required.')
  process.exit(2)
}
if (/harborreceptionist\.com|prod[-_.]/i.test(URL)) {
  console.error('Abort: DATABASE_URL looks like production. This script is for staging only.')
  process.exit(2)
}

const dir = 'supabase/migrations'
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .sort()

console.log(`Applying ${files.length} migration files from ${dir}/ in alphabetical order:`)
console.log(files.map((f) => `  - ${f}`).join('\n'))

const c = new Client({ connectionString: URL, ssl: URL.includes('rds.amazonaws.com') ? { rejectUnauthorized: false } : false })
await c.connect()

let totalOk = 0, totalSkip = 0, totalFail = 0

for (const file of files) {
  const sql = readFileSync(join(dir, file), 'utf8')
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')

  const stmts = sql
    .split(/;\s*\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

  let ok = 0, skip = 0, fail = 0
  for (const stmt of stmts) {
    try {
      await c.query(stmt + ';')
      ok++
    } catch (err) {
      const m = String(err.message).toLowerCase()
      if (
        m.includes('already exists') ||
        m.includes('duplicate') ||
        m.includes('does not exist') && m.includes('drop') // tolerate "drop if exists" misses
      ) {
        skip++
      } else {
        fail++
        console.log(`    [${file}] FAIL: ${err.message.split('\n')[0]}`)
        console.log(`            stmt: ${stmt.slice(0, 140).replace(/\s+/g, ' ')}...`)
      }
    }
  }
  totalOk += ok
  totalSkip += skip
  totalFail += fail
  const status = fail > 0 ? 'WARN' : 'OK'
  console.log(`  ${status} ${file}: ${ok} applied, ${skip} skipped, ${fail} failed`)
}

await c.end()

console.log(`\n=== Summary: ${totalOk} applied, ${totalSkip} skipped, ${totalFail} failed ===`)
if (totalFail > 0) {
  console.log('\nFailed statements above are likely either dependency-order issues or schema drifts. Review and re-run; the script is idempotent.')
  process.exit(1)
}
process.exit(0)
