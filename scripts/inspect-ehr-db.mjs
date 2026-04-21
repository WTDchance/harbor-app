#!/usr/bin/env node
// Report which public tables exist on DB #2 and which are missing vs expected.

import pg from 'pg'
const { Client } = pg

const DB_URL = process.env.SUPABASE_DB_URL
if (!DB_URL || !DB_URL.includes('badelywhoacuccztxhjh')) {
  console.error('SUPABASE_DB_URL missing or not pointing at dev DB. Abort.')
  process.exit(2)
}

const CRITICAL = [
  'practices', 'users', 'patients', 'appointments', 'call_logs',
  'sms_conversations', 'audit_log', 'therapists',
]
const DESIRED = [
  'intake_forms', 'crisis_alerts', 'calendar_connections',
  'patient_assessments', 'patient_communications', 'practice_analytics',
  'waitlist', 'stedi_payers', 'insurance_verifications',
]

const client = new Client({ connectionString: DB_URL })
await client.connect()
const { rows } = await client.query(
  "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
)
const have = new Set(rows.map((r) => r.tablename))
await client.end()

console.log(`Tables present: ${have.size}`)
console.log(`\nCRITICAL (EHR cannot proceed without these):`)
for (const t of CRITICAL) console.log(`  ${have.has(t) ? 'OK ' : 'MISS'} ${t}`)
console.log(`\nDESIRED (EHR will eventually integrate with these):`)
for (const t of DESIRED) console.log(`  ${have.has(t) ? 'OK ' : 'MISS'} ${t}`)
console.log(`\nAll tables:\n  ${[...have].sort().join('\n  ')}`)
