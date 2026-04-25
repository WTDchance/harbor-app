#!/usr/bin/env node
// Enable Postgres extensions that Harbor migrations depend on.
import pg from 'pg'
const { Client } = pg
const DB_URL = process.env.SUPABASE_DB_URL
if (!DB_URL || !DB_URL.includes('badelywhoacuccztxhjh')) {
  console.error('Abort: not pointing at dev DB.')
  process.exit(2)
}
const EXTENSIONS = ['pg_trgm', 'uuid-ossp', 'pgcrypto']
const client = new Client({ connectionString: DB_URL })
await client.connect()
for (const ext of EXTENSIONS) {
  try {
    await client.query(`CREATE EXTENSION IF NOT EXISTS "${ext}"`)
    console.log(`  ok   ${ext}`)
  } catch (err) {
    console.log(`  fail ${ext}: ${err.message}`)
  }
}
await client.end()
