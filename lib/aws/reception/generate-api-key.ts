// Wave 47 — Reception product split.
//
// Mints a fresh API key for a practice. The plaintext is shown to the
// caller exactly once (returned here, displayed on the API Keys page);
// only the SHA-256 hash + a short prefix are persisted.
//
// Format: hb_live_<32 base32 chars>. The first 12 characters of the
// full string ("hb_live_AAAA") are stored as key_prefix for UI display
// and operator forensic lookup.

import crypto from 'crypto'
import { pool } from '@/lib/aws/db'

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

function base32Random(length: number): string {
  const bytes = crypto.randomBytes(length)
  let out = ''
  for (let i = 0; i < length; i++) {
    out += BASE32_ALPHABET[bytes[i] % 32]
  }
  return out
}

export function hashApiKey(plaintext: string): string {
  return crypto.createHash('sha256').update(plaintext).digest('hex')
}

export interface GenerateApiKeyResult {
  plaintext: string
  key_id: string
  key_prefix: string
}

export async function generateApiKey(
  practice_id: string,
  scopes: string[],
  created_by: string | null,
): Promise<GenerateApiKeyResult> {
  const suffix = base32Random(32)
  const plaintext = `hb_live_${suffix}`
  const key_hash = hashApiKey(plaintext)
  const key_prefix = plaintext.slice(0, 12)

  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO reception_api_keys (
        practice_id, key_hash, key_prefix, scopes, created_by_user_id
     ) VALUES ($1, $2, $3, $4::text[], $5)
     RETURNING id`,
    [practice_id, key_hash, key_prefix, scopes, created_by],
  )

  return { plaintext, key_id: rows[0].id, key_prefix }
}

/**
 * Revoke (soft-delete) an API key by setting revoked_at = now().
 * Returns true if a row was updated (i.e. key existed, belonged to
 * this practice, and was not already revoked).
 */
export async function revokeApiKey(args: {
  keyId: string
  practiceId: string | null
}): Promise<boolean> {
  if (!args.practiceId) return false
  const { rowCount } = await pool.query(
    `UPDATE reception_api_keys
        SET revoked_at = now()
      WHERE id = $1
        AND practice_id = $2
        AND revoked_at IS NULL`,
    [args.keyId, args.practiceId],
  )
  return (rowCount ?? 0) > 0
}
