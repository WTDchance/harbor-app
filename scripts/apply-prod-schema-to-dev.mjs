#!/usr/bin/env node
/**
 * Apply supabase/prod-schema.sql (produced by dump-prod-schema.mjs) onto DB #2.
 *
 * Safe to re-run: errors like "already exists" are logged and skipped.
 *
 * Usage:
 *   node --env-file=.env.ehr scripts/apply-prod-schema-to-dev.mjs
 */

import { readFileSync } from 'node:fs'
import pg from 'pg'

const { Client } = pg
const URL = process.env.SUPABASE_DB_URL
if (!URL || !URL.includes('badelywhoacuccztxhjh')) {
  console.error('Abort: SUPABASE_DB_URL not pointing at dev DB.')
  process.exit(2)
}

const rawSql = readFileSync('supabase/prod-schema.sql', 'utf8')
// Strip pure-comment lines first, then split.
const sql = rawSql
  .split('\n')
  .filter((l) => !l.trim().startsWith('--'))
  .join('\n')
const statements = sql
  .split(/;\s*\n/)
  .map((s) => s.trim())
  .filter((s) => s.length > 0)

const c = new Client({ connectionString: URL })
await c.connect()

let ok = 0, skip = 0, fail = 0
for (const stmt of statements) {
  try {
    await c.query(stmt + ';')
    ok++
  } catch (err) {
    const m = String(err.message).toLowerCase()
    if (m.includes('already exists') || m.includes('duplicate')) {
      skip++
    } else {
      fail++
      console.log(`  FAIL: ${err.message.split('\n')[0]}`)
      console.log(`    stmt: ${stmt.slice(0, 120)}...`)
    }
  }
}
await c.end()
console.log(`\n${ok} applied, ${skip} benign-skipped, ${fail} failed, ${statements.length} total.`)
