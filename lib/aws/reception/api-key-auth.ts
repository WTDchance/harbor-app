// Wave 47 — Reception product split.
//
// Verifies "Authorization: Bearer hb_live_<key>" against the
// reception_api_keys table. Only active (revoked_at IS NULL) rows match.
// On success, last_used_at is bumped (best-effort) and the practice_id +
// scopes are returned to the route handler.

import { hashApiKey } from './generate-api-key'
import { pool } from '@/lib/aws/db'

export interface ApiKeyContext {
  practice_id: string
  scopes: string[]
  key_id: string
}

function parseBearer(req: Request): string | null {
  const header = req.headers.get('authorization') || req.headers.get('Authorization')
  if (!header) return null
  const m = header.match(/^Bearer\s+(\S+)$/i)
  if (!m) return null
  const token = m[1]
  if (!token.startsWith('hb_live_')) return null
  return token
}

export async function verifyApiKey(req: Request): Promise<ApiKeyContext | null> {
  const token = parseBearer(req)
  if (!token) return null

  const key_hash = hashApiKey(token)
  const { rows } = await pool.query<{
    id: string
    practice_id: string
    scopes: string[]
  }>(
    `SELECT id, practice_id, scopes
       FROM reception_api_keys
      WHERE key_hash = $1
        AND revoked_at IS NULL
      LIMIT 1`,
    [key_hash],
  )
  const row = rows[0]
  if (!row) return null

  // Best-effort last_used_at bump. Never block the request on this.
  pool
    .query(`UPDATE reception_api_keys SET last_used_at = now() WHERE id = $1`, [row.id])
    .catch((err) => {
      console.error('[reception-api] last_used_at bump failed:', (err as Error).message)
    })

  return {
    practice_id: row.practice_id,
    scopes: row.scopes ?? [],
    key_id: row.id,
  }
}

export function hasScope(ctx: ApiKeyContext, required: string): boolean {
  return ctx.scopes.includes(required)
}
