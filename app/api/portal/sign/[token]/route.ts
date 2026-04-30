// W52 D1 — patient-facing GET + POST for the e-sign flow.
//
// Token-gated; no portal session required.
import { NextResponse, type NextRequest } from 'next/server'
import { pool } from '@/lib/aws/db'
import { writeAuditLog, extractIp } from '@/lib/audit'
import { ESIGN_METHOD, verifyIdentityByDob } from '@/lib/ehr/esign'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!token || !token.startsWith('sig_')) return NextResponse.json({ error: 'invalid_token' }, { status: 400 })

  const { rows } = await pool.query(
    `SELECT r.id, r.practice_id, r.patient_id, r.lead_id, r.rendered_body_html,
            r.status, r.expires_at, r.signed_at,
            t.name AS template_name, t.category,
            COALESCE(p.first_name, l.first_name) AS first_name,
            COALESCE(p.last_name, l.last_name) AS last_name,
            pr.name AS practice_name
       FROM document_signature_requests r
       LEFT JOIN practice_document_templates t ON t.id = r.template_id
       LEFT JOIN patients p   ON p.id = r.patient_id
       LEFT JOIN reception_leads l ON l.id = r.lead_id
       JOIN practices pr      ON pr.id = r.practice_id
      WHERE r.portal_token = $1 LIMIT 1`,
    [token],
  )
  if (rows.length === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const row = rows[0]
  if (row.status === 'withdrawn') return NextResponse.json({ error: 'withdrawn' }, { status: 410 })
  if (new Date(row.expires_at) < new Date() && row.status !== 'signed') {
    await pool.query(`UPDATE document_signature_requests SET status = 'expired' WHERE id = $1 AND status NOT IN ('signed','withdrawn')`, [row.id]).catch(() => null)
    return NextResponse.json({ error: 'expired' }, { status: 410 })
  }
  if (row.status === 'pending') {
    await pool.query(`UPDATE document_signature_requests SET status = 'viewed', viewed_at = NOW() WHERE id = $1 AND status = 'pending'`, [row.id]).catch(() => null)
  }

  return NextResponse.json({
    request: {
      id: row.id,
      status: row.status === 'pending' ? 'viewed' : row.status,
      body_html: row.rendered_body_html,
      template_name: row.template_name,
      category: row.category,
      signed_at: row.signed_at,
    },
    signer: { first_name: row.first_name, last_name: row.last_name },
    practice: { name: row.practice_name },
  })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!token || !token.startsWith('sig_')) return NextResponse.json({ error: 'invalid_token' }, { status: 400 })

  const body = await req.json().catch(() => null) as
    { signer_name?: string; signature_method?: string; signature_data?: string;
      i_agree?: boolean; verify_dob?: string } | null
  if (!body || !body.i_agree) return NextResponse.json({ error: 'i_agree_required' }, { status: 400 })
  if (!body.signer_name || !body.signature_method || !body.signature_data) {
    return NextResponse.json({ error: 'signer_fields_required' }, { status: 400 })
  }
  if (!(ESIGN_METHOD as readonly string[]).includes(body.signature_method)) {
    return NextResponse.json({ error: 'invalid_method' }, { status: 400 })
  }

  const r = await pool.query(
    `SELECT r.id, r.practice_id, r.patient_id, r.lead_id, r.status, r.expires_at,
            COALESCE(p.date_of_birth, l.date_of_birth) AS expected_dob
       FROM document_signature_requests r
       LEFT JOIN patients p ON p.id = r.patient_id
       LEFT JOIN reception_leads l ON l.id = r.lead_id
      WHERE r.portal_token = $1 LIMIT 1`,
    [token],
  )
  if (r.rows.length === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const row = r.rows[0]
  if (row.status === 'signed') return NextResponse.json({ error: 'already_signed' }, { status: 409 })
  if (row.status === 'withdrawn' || row.status === 'expired') return NextResponse.json({ error: row.status }, { status: 410 })
  if (new Date(row.expires_at) < new Date()) return NextResponse.json({ error: 'expired' }, { status: 410 })

  const verified = verifyIdentityByDob(body.verify_dob, row.expected_dob ? String(row.expected_dob).slice(0, 10) : null)

  const ip = extractIp(req.headers)
  const ua = req.headers.get('user-agent')

  await pool.query('BEGIN')
  try {
    await pool.query(
      `INSERT INTO document_signatures
         (practice_id, signature_request_id, signer_name, signature_method,
          signature_data, identity_verified, identity_verification_method,
          ip_address, user_agent, audit_trail_s3_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::inet, $9, $10)`,
      [
        row.practice_id, row.id, String(body.signer_name).slice(0, 200),
        body.signature_method, String(body.signature_data).slice(0, 500_000),
        verified, verified ? 'dob_match' : null,
        ip, ua, null,
      ],
    )
    await pool.query(
      `UPDATE document_signature_requests
          SET status = 'signed', signed_at = NOW()
        WHERE id = $1`,
      [row.id],
    )
    await pool.query('COMMIT')
  } catch (e) {
    await pool.query('ROLLBACK').catch(() => null)
    return NextResponse.json({ error: 'persist_failed' }, { status: 500 })
  }

  await writeAuditLog({
    practice_id: row.practice_id,
    action: 'document.signed',
    resource_type: 'document_signature_request',
    resource_id: row.id,
    severity: verified ? 'info' : 'warning',
    details: {
      signer_name: body.signer_name,
      method: body.signature_method,
      identity_verified: verified,
    },
    ip_address: ip,
    user_agent: ua,
  })

  return NextResponse.json({ ok: true, identity_verified: verified })
}
