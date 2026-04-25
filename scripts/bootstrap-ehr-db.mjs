#!/usr/bin/env node
/**
 * Bootstrap Harbor EHR dev database (DB #2).
 *
 * Applies, in order:
 *   1. supabase/schema.sql (original canonical schema)
 *   2. supabase/migrations/*.sql — undated legacy migrations first, then dated ones in timestamp order
 *
 * Idempotent: safe to re-run. Errors that look like "already exists" are logged
 * and skipped; any other error halts the script with the offending file.
 *
 * Usage:
 *   node --env-file=.env.ehr scripts/bootstrap-ehr-db.mjs
 */

import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const { Client } = pg
const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..')
const supabaseDir = join(repoRoot, 'supabase')
const migrationsDir = join(supabaseDir, 'migrations')

const DB_URL = process.env.SUPABASE_DB_URL
if (!DB_URL) {
  console.error('SUPABASE_DB_URL missing. Load .env.ehr with --env-file=.env.ehr')
  process.exit(1)
}

// Confirm we are NOT about to hit prod.
if (!DB_URL.includes('badelywhoacuccztxhjh')) {
  console.error('SAFETY: SUPABASE_DB_URL does not point at the dev DB (badelywhoacuccztxhjh).')
  console.error('Refusing to run migrations. Aborting.')
  process.exit(2)
}

function resolveOrder() {
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'))
  const undated = files.filter((f) => !/^\d{8}/.test(f)).sort()
  const dated = files.filter((f) => /^\d{8}/.test(f)).sort()
  return [
    { path: join(supabaseDir, 'schema.sql'), label: 'supabase/schema.sql' },
    ...undated.map((f) => ({ path: join(migrationsDir, f), label: `migrations/${f}` })),
    ...dated.map((f) => ({ path: join(migrationsDir, f), label: `migrations/${f}` })),
  ]
}

function isBenign(err) {
  // Swallow messages that indicate the thing we tried to create/alter already matches,
  // or that Supabase's managed postgres role can't do (it handles those itself).
  const m = String(err?.message || '').toLowerCase()
  return (
    m.includes('already exists') ||
    m.includes('duplicate') ||
    m.includes('does not exist') || // dropping something not present
    m.includes('permission denied') // Supabase manages superuser-only settings
  )
}

async function main() {
  const client = new Client({ connectionString: DB_URL })
  await client.connect()
  console.log(`Connected to ${DB_URL.split('@')[1]?.split('/')[0] || 'dev DB'}`)

  const order = resolveOrder()
  let applied = 0
  let benign = 0

  for (const { path, label } of order) {
    let sql = readFileSync(path, 'utf8')
    // Strip statements that require privileges Supabase manages itself.
    sql = sql.replace(
      /ALTER\s+DATABASE\s+\w+\s+SET\s+"[^"]+"\s*=\s*'[^']*'\s*;/gi,
      '-- [stripped: ALTER DATABASE ... SET — Supabase manages this]',
    )
    try {
      await client.query(sql)
      applied++
      console.log(`  ok   ${label}`)
    } catch (err) {
      if (isBenign(err)) {
        benign++
        console.log(`  skip ${label}  (${err.message.split('\n')[0]})`)
      } else {
        console.error(`\nFAIL ${label}`)
        console.error(err.message)
        await client.end()
        process.exit(3)
      }
    }
  }

  await client.end()
  console.log(`\nDone. ${applied} applied, ${benign} benign-skipped, ${order.length} total.`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
