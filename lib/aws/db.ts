// Harbor — RDS Postgres client.
//
// Path B replacement for @supabase/supabase-js. A single shared pg.Pool
// configured from env (PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE/PGSSLMODE).
//
// Phase 2 will introduce Drizzle on top of this pool. For Phase 1 we keep
// it tight: parameterized queries through pool.query(), and a typed helper
// for the common "look up the user's practice" lookup.

import { Pool } from 'pg'

declare global {
  // eslint-disable-next-line no-var
  var __harborPgPool: Pool | undefined
}

function makePool(): Pool {
  return new Pool({
    host: process.env.PGHOST,
    port: process.env.PGPORT ? Number(process.env.PGPORT) : 5432,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE,
    ssl:
      process.env.PGSSLMODE === 'require'
        ? { rejectUnauthorized: false } // RDS uses Amazon-issued certs; verify chain in a later hardening pass
        : undefined,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  })
}

// Reuse the pool across hot reloads in dev and across requests in prod.
export const pool: Pool = globalThis.__harborPgPool ?? makePool()
if (process.env.NODE_ENV !== 'production') {
  globalThis.__harborPgPool = pool
}

export type DbUserRow = {
  id: string
  cognito_sub: string
  email: string
  full_name: string | null
  practice_id: string | null
  role: 'owner' | 'clinician' | 'admin' | 'support'
}

export type DbPracticeRow = {
  id: string
  name: string
  slug: string | null
  owner_email: string
  timezone: string
  provisioning_state: string
  voice_provider: string
  greeting: string | null
}

/**
 * Resolve the authenticated Cognito user → RDS user row + their practice.
 * Returns null if the user has no row in users (i.e. not yet linked to a practice).
 */
export async function getUserAndPractice(
  cognitoSub: string,
): Promise<{ user: DbUserRow; practice: DbPracticeRow | null } | null> {
  const userResult = await pool.query<DbUserRow>(
    `SELECT id, cognito_sub, email, full_name, practice_id, role
       FROM users
      WHERE cognito_sub = $1
      LIMIT 1`,
    [cognitoSub],
  )
  const user = userResult.rows[0]
  if (!user) return null

  let practice: DbPracticeRow | null = null
  if (user.practice_id) {
    const practiceResult = await pool.query<DbPracticeRow>(
      `SELECT id, name, slug, owner_email, timezone, provisioning_state, voice_provider, greeting
         FROM practices
        WHERE id = $1
        LIMIT 1`,
      [user.practice_id],
    )
    practice = practiceResult.rows[0] ?? null
  }
  return { user, practice }
}

// ── Drizzle layer ─────────────────────────────────────────────────────────
// Lightweight ORM on top of the existing pg.Pool. Use `db` for typed queries,
// drop down to `pool.query()` for raw SQL or transactions.

import { drizzle } from 'drizzle-orm/node-postgres'
import * as schema from './schema'

declare global {
  // eslint-disable-next-line no-var
  var __harborDrizzle: ReturnType<typeof drizzle> | undefined
}

export const db = globalThis.__harborDrizzle ?? drizzle(pool, { schema, casing: 'snake_case' })
if (process.env.NODE_ENV !== 'production') {
  globalThis.__harborDrizzle = db
}

export { schema }
