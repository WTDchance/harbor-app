// lib/aws/reception/generate-api-key.ts
//
// W48 T2 — mint a Reception API key. Plaintext is returned ONCE for
// display; only the SHA-256 hash + first-12-char prefix are persisted.
//
// Format: hb_live_<32 base32 chars>
// The 32-char base32 suffix carries 160 bits of entropy from
// crypto.randomBytes(20). Sufficient for an API key.

import { randomBytes, createHash } from 'node:crypto'
import { pool } from '@/lib/aws/db'
import { auditSystemEvent } from '@/lib/aws/ehr/audit'

const PREFIX = 'hb_live_'
const PREFIX_LEN = 12 // first 12 chars (PREFIX + 4 of body) for display

// Crockford-style base32 alphabet — drops I, L, O, U to avoid visual
// confusion when a key is read aloud.
const ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789'
function toBase32(bytes: Uint8Array): string {
  let bits = 0; let value = 0; let out = ''
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i]
    bits += 8
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31]
  return out
}

export interface MintedKey {
  id: string
  plaintext: string  // returned ONCE; never recoverable
  prefix: string     // 'hb_live_AAAA' style for display
}

export async function generateApiKey(args: {
  practiceId: string
  scopes: string[]
  createdByUserId?: string | null
}): Promise<MintedKey> {
  const suffix = toBase32(randomBytes(20)).slice(0, 32)
  const plaintext = `${PREFIX}${suffix}`
  const hash = createHash('sha256').update(plaintext).digest('hex')
  const prefix = plaintext.slice(0, PREFIX_LEN)

  const ins = await pool.query(
    `INSERT INTO reception_api_keys
       (practice_id, key_hash, key_prefix, scopes, created_by_user_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [args.practiceId, hash, prefix, args.scopes, args.createdByUserId ?? null],
  )

  await auditSystemEvent({
    action: 'reception_api_key.created',
    practiceId: args.practiceId,
    resourceType: 'reception_api_key',
    resourceId: ins.rows[0].id,
    details: { prefix, scope_count: args.scopes.length },
  })

  return { id: ins.rows[0].id, plaintext, prefix }
}

export async function revokeApiKey(args: {
  keyId: string
  practiceId: string
}): Promise<boolean> {
  const r = await pool.query(
    `UPDATE reception_api_keys
        SET revoked_at = NOW()
      WHERE id = $1 AND practice_id = $2 AND revoked_at IS NULL`,
    [args.keyId, args.practiceId],
  )
  if ((r.rowCount ?? 0) > 0) {
    await auditSystemEvent({
      action: 'reception_api_key.revoked',
      practiceId: args.practiceId,
      resourceType: 'reception_api_key',
      resourceId: args.keyId,
      details: {},
    })
    return true
  }
  return false
}
