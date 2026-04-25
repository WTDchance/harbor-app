#!/usr/bin/env node
/**
 * Seed one test practice + one test auth user on DB #2 so you can log in and
 * poke at the EHR. Idempotent — safe to re-run.
 *
 * Defaults — change via env vars if you want different creds:
 *   EHR_TEST_EMAIL     (default: ehr-dev@harbor.local)
 *   EHR_TEST_PASSWORD  (default: HarborEhrDev1!)
 *
 * Usage:
 *   node --env-file=.env.ehr scripts/seed-ehr-test-data.mjs
 */

import pg from 'pg'
import { createClient } from '@supabase/supabase-js'

const { Client } = pg
const DB_URL = process.env.SUPABASE_DB_URL
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!DB_URL || !DB_URL.includes('badelywhoacuccztxhjh')) {
  console.error('Abort: SUPABASE_DB_URL not pointing at dev DB.')
  process.exit(2)
}
if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error('Abort: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing.')
  process.exit(2)
}

const TEST_EMAIL = process.env.EHR_TEST_EMAIL || 'ehr-dev@harbor.local'
const TEST_PASSWORD = process.env.EHR_TEST_PASSWORD || 'HarborEhrDev1!'
const TEST_PRACTICE_ID = '00000000-0000-0000-0000-00000000ED01'

const db = new Client({ connectionString: DB_URL })
await db.connect()

// --- 1. Ensure test practice exists + EHR is enabled for it ---
const practiceRes = await db.query(
  `INSERT INTO practices (id, name, ai_name, phone_number, timezone, notification_email, ehr_enabled)
   VALUES ($1, $2, $3, $4, $5, $6, true)
   ON CONFLICT (id) DO UPDATE
     SET name = EXCLUDED.name,
         notification_email = EXCLUDED.notification_email,
         ehr_enabled = true
   RETURNING id, name, ehr_enabled`,
  [TEST_PRACTICE_ID, 'EHR Dev Test Practice', 'Ellie', '+15550000001', 'America/Los_Angeles', TEST_EMAIL],
)
console.log(`  practice: ${practiceRes.rows[0].id} (${practiceRes.rows[0].name}, ehr_enabled=${practiceRes.rows[0].ehr_enabled})`)

// --- 1b. Ensure one test patient exists so the EHR has something to attach notes to ---
const TEST_PATIENT_ID = '00000000-0000-0000-0000-00000000ED10'
await db.query(
  `INSERT INTO patients (id, practice_id, first_name, last_name, phone, email, reason_for_seeking)
   VALUES ($1, $2, 'Sample', 'Patient', '+15550000010', 'sample.patient@example.com', 'Anxiety — dev seed')
   ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name`,
  [TEST_PATIENT_ID, TEST_PRACTICE_ID],
)
console.log(`  patient:  ${TEST_PATIENT_ID} (Sample Patient)`)

await db.end()

// --- 2. Ensure auth user exists + set password ---
const supa = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { autoRefreshToken: false, persistSession: false },
})

let userId = null
{
  const { data: list, error } = await supa.auth.admin.listUsers({ perPage: 200 })
  if (error) throw error
  const existing = list.users.find((u) => u.email === TEST_EMAIL)
  if (existing) {
    userId = existing.id
    await supa.auth.admin.updateUserById(userId, {
      password: TEST_PASSWORD,
      app_metadata: { practice_id: TEST_PRACTICE_ID },
      email_confirm: true,
    })
    console.log(`  auth user (updated): ${TEST_EMAIL} -> ${userId}`)
  } else {
    const { data, error: createErr } = await supa.auth.admin.createUser({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      email_confirm: true,
      app_metadata: { practice_id: TEST_PRACTICE_ID },
    })
    if (createErr) throw createErr
    userId = data.user.id
    console.log(`  auth user (created): ${TEST_EMAIL} -> ${userId}`)
  }
}

// --- 3. Ensure public.users row linking auth user to the practice ---
const db2 = new Client({ connectionString: DB_URL })
await db2.connect()
await db2.query(
  `INSERT INTO users (id, practice_id, email, role)
   VALUES ($1, $2, $3, 'admin')
   ON CONFLICT (id) DO UPDATE
     SET practice_id = EXCLUDED.practice_id, email = EXCLUDED.email, role = 'admin'`,
  [userId, TEST_PRACTICE_ID, TEST_EMAIL],
)
console.log(`  public.users row linked`)
await db2.end()

console.log(`\nDone. Log in at http://localhost:3000 with:`)
console.log(`  email:    ${TEST_EMAIL}`)
console.log(`  password: ${TEST_PASSWORD}`)
console.log(`  practice: EHR Dev Test Practice (${TEST_PRACTICE_ID})`)
