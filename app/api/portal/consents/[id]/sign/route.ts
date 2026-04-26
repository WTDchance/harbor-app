// Patient signs a pending consent. Single-row UPDATE with optimistic lock
// (WHERE status='pending' RETURNING *) so concurrent submits 409 cleanly
// without writing two timestamps.
//
// SIGNATURE_HASH: SHA-256 of the canonical signed-record field set
// joined by U+241E (matches the note-signing convention from Wave 13).
// Field set: [id, consent_type, version, signed_by_name, signed_at_iso,
//             signed_method, signature_ip||'']. The legacy route did not
// populate signature_hash; AWS adds it for tamper-detect parity with
// note signing. Document the algo here so future verification stays
// reproducible.

import { NextResponse, type NextRequest } from 'next/server'
import { createHash } from 'node:crypto'
import { requirePortalSession } from '@/lib/aws/portal-auth'
import { pool } from '@/lib/aws/db'
import { auditPortalAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function consentSignatureHash(input: {
  id: string
  consent_type: string
  version: string
  signed_by_name: string
  signed_at: string
  signed_method: string
  signature_ip: string | null
}): string {
  const parts = [
    input.id,
    input.consent_type,
    input.version,
    input.signed_by_name,
    input.signed_at,
    input.signed_method,
    input.signature_ip || '',
  ]
  return createHash('sha256').update(parts.join('␞')).digest('hex')
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const sess = await requirePortalSession()
  if (sess instanceof NextResponse) return sess
  const { id } = await params

  const body = await req.json().catch(() => null) as { signed_by_name?: string } | null
  const name = (body?.signed_by_name || '').toString().trim()
  if (!name) return NextResponse.json({ error: 'Signed name required' }, { status: 400 })

  // Verify ownership BEFORE the lock-update so a 404 is fast.
  const lookup = await pool.query(
    `SELECT id, patient_id, practice_id, status, consent_type, version
       FROM ehr_consents
      WHERE id = $1 LIMIT 1`,
    [id],
  ).catch(() => ({ rows: [] as any[] }))
  const consent = lookup.rows[0]
  if (!consent || consent.patient_id !== sess.patientId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  if (consent.status === 'signed') {
    return NextResponse.json({ error: 'Already signed' }, { status: 409 })
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null
  const signedAt = new Date().toISOString()
  const hash = consentSignatureHash({
    id: consent.id,
    consent_type: consent.consent_type,
    version: consent.version,
    signed_by_name: name,
    signed_at: signedAt,
    signed_method: 'portal',
    signature_ip: ip,
  })

  // Optimistic lock — only updates if still pending.
  const upd = await pool.query(
    `UPDATE ehr_consents
        SET status = 'signed',
            signed_at = $1,
            signed_by_name = $2,
            signed_method = 'portal',
            signature_ip = $3::inet,
            signature_hash = $4,
            updated_at = NOW()
      WHERE id = $5 AND status = 'pending'
    RETURNING *`,
    [signedAt, name, ip, hash, id],
  )
  if (!upd.rows[0]) {
    // Race lost to a concurrent sign — surface 409 with current state hint.
    return NextResponse.json(
      { error: 'Already signed by another submission. Reload to see current state.' },
      { status: 409 },
    )
  }

  auditPortalAccess({
    session: sess,
    action: 'portal.consent.sign',
    resourceType: 'ehr_consent',
    resourceId: id,
    details: {
      consent_type: consent.consent_type,
      version: consent.version,
      method: 'portal',
      ip,
      hash,
    },
  }).catch(() => {})

  return NextResponse.json({ consent: upd.rows[0] })
}
