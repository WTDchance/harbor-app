// lib/aws/reception/api-key-auth.ts
//
// W48 T2 — verify Reception API keys for /api/reception/v1/*.
//
// Authorization header convention: `Bearer hb_live_<32chars>`.
// We SHA-256 hash the bearer value and look it up. last_used_at is
// updated on a 1-in-100 sample so a high-QPS partner doesn't pin the
// row in WAL. used-event audit fires on the same sample.

import type { NextRequest } from 'next/server'
import { createHash } from 'node:crypto'
import { pool } from '@/lib/aws/db'
import { auditSystemEvent } from '@/lib/aws/ehr/audit'

export interface ReceptionApiCtx {
  practice_id: string
  scopes: string[]
  key_id: string
  key_prefix: string
}

export async function verifyApiKey(req: NextRequest): Promise<ReceptionApiCtx | null> {
  const auth = req.headers.get('authorization') || ''
  if (!auth.startsWith('Bearer ')) return null
  const plaintext = auth.slice(7).trim()
  if (!plaintext.startsWith('hb_live_') || plaintext.length < 20) return null

  const hash = createHash('sha256').update(plaintext).digest('hex')

  const { rows } = await pool.query(
    `SELECT id, practice_id, scopes, key_prefix
       FROM reception_api_keys
      WHERE key_hash = $1 AND revoked_at IS NULL
      LIMIT 1`,
    [hash],
  )
  if (rows.length === 0) return null

  // Sample-based last_used_at update + used audit so we don't generate
  // hot-row contention or audit_log spam.
  if (Math.random() < 0.01) {
    pool.query(
      `UPDATE reception_api_keys SET last_used_at = NOW() WHERE id = $1`,
      [rows[0].id],
    ).catch(() => {})
    auditSystemEvent({
      action: 'reception_api_key.used',
      practiceId: rows[0].practice_id,
      resourceType: 'reception_api_key',
      resourceId: rows[0].id,
      details: { sampled: true },
    }).catch(() => {})
  }

  return {
    practice_id: rows[0].practice_id,
    scopes: rows[0].scopes ?? [],
    key_id: rows[0].id,
    key_prefix: rows[0].key_prefix,
  }
}
