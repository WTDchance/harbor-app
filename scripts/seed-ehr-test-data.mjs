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

// --- 1. Ensure test practice exists ---
const practiceRes = await db.query(
  `INSERT INTO practices (id, name, ai_name, phone_number, timezone)
   VALUES ($1, $2, $3, $4, $5)
   ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
   RETURNING id, name`,
  [TEST_PRACTICE_ID, 'EHR Dev Test Practice', 'Ellie', '+15550000001', 'America/Los_Angeles'],
)
console.log(`  practice: ${practiceRes.rows[0].id} (${practiceRes.rows[0].name})`)

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
