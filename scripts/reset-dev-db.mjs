#!/usr/bin/env node
/**
 * Drop all public tables on DB #2. Hard-gated to the dev DB only.
 *
 * Usage:
 *   node --env-file=.env.ehr scripts/reset-dev-db.mjs
 */

import pg from 'pg'
const { Client } = pg
const URL = process.env.SUPABASE_DB_URL
if (!URL || !URL.includes('badelywhoacuccztxhjh')) {
  console.error('Abort: not pointing at dev DB.')
  process.exit(2)
}

const c = new Client({ connectionString: URL })
await c.connect()

const { rows: tables } = await c.query(
  "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
)

console.log(`Dropping ${tables.length} public tables on DB #2...`)
for (const { tablename } of tables) {
  await c.query(`DROP TABLE IF EXISTS public."${tablename}" CASCADE`)
}
await c.end()
console.log('Done.')
