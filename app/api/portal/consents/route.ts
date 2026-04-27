// app/api/portal/consents/route.ts
//
// Wave 38 TS4 — patient portal: list active consent documents + whether
// the current patient has signed each.
//
// GET  -> { documents: [{ id, kind, version, body_md, required, signed_at | null }] }
// POST -> { document_id, signature_data_url, signed_name? }
//         -> { ok: true, signature_id }

import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/aws/db'
import { requirePortalSession } from '@/lib/aws/portal-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest) {
  const sess = await requirePortalSession()
  if (sess instanceof NextResponse) return sess

  // Latest version per kind for this practice.
  const { rows } = await pool.query(
    `WITH latest AS (
       SELECT DISTINCT ON (kind) id, practice_id, kind, version, body_md,
              required, effective_at
         FROM consent_documents
        WHERE practice_id = $1
        ORDER BY kind, effective_at DESC
     )
     SELECT l.id, l.kind, l.version, l.body_md, l.required, l.effective_at,
            s.signed_at
       FROM latest l
       LEFT JOIN consent_signatures s
         ON s.document_id = l.id AND s.patient_id = $2
      ORDER BY l.required DESC, l.kind ASC`,
    [sess.practiceId, sess.patientId],
  )

  return NextResponse.json({ documents: rows })
}

export async function POST(req: NextRequest) {
  const sess = await requirePortalSession()
  if (sess instanceof NextResponse) return sess

  const body = await req.json().catch(() => null) as any
  const documentId = String(body?.document_id || '')
  const signatureDataUrl = String(body?.signature_data_url || '')
  const signedName = body?.signed_name ? String(body.signed_name) : null

  if (!documentId || !signatureDataUrl) {
    return NextResponse.json({ error: 'document_id and signature_data_url required' }, { status: 400 })
  }
  // Sanity check: data URL is bounded so a malicious client can't plant a 50MB blob.
  if (signatureDataUrl.length > 1_000_000) {
    return NextResponse.json({ error: 'signature too large' }, { status: 413 })
  }
  if (!signatureDataUrl.startsWith('data:image/')) {
    return NextResponse.json({ error: 'signature must be a data URL' }, { status: 400 })
  }

  // Doc must belong to this patient's practice.
  const { rows: docRows } = await pool.query(
    `SELECT id FROM consent_documents WHERE id = $1 AND practice_id = $2 LIMIT 1`,
    [documentId, sess.practiceId],
  )
  if (docRows.length === 0) {
    return NextResponse.json({ error: 'document_not_found' }, { status: 404 })
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null
  const ua = req.headers.get('user-agent') || null

  const ins = await pool.query(
    `INSERT INTO consent_signatures (document_id, patient_id, signature_data_url, signed_name, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5::inet, $6)
     ON CONFLICT (document_id, patient_id) DO UPDATE
       SET signed_at = EXCLUDED.signed_at,
           signature_data_url = EXCLUDED.signature_data_url,
           signed_name = EXCLUDED.signed_name,
           ip = EXCLUDED.ip,
           user_agent = EXCLUDED.user_agent
     RETURNING id, signed_at`,
    [documentId, sess.patientId, signatureDataUrl, signedName, ip, ua],
  )

  // Best-effort audit
  try {
    await pool.query(
      `INSERT INTO audit_logs (user_id, user_email, practice_id, action, resource_type, resource_id, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [null, null, sess.practiceId, 'consent.create', 'consent_signature', ins.rows[0].id, JSON.stringify({ patient_id: sess.patientId, document_id: documentId })],
    )
  } catch {}

  return NextResponse.json({ ok: true, signature_id: ins.rows[0].id, signed_at: ins.rows[0].signed_at })
}
