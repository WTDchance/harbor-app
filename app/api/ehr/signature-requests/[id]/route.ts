// W52 D1 — therapist views the status of a signature request.
import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id } = await params

  const r = await pool.query(
    `SELECT r.id, r.patient_id, r.lead_id, r.template_id, r.delivery_channel,
            r.status, r.expires_at, r.viewed_at, r.signed_at, r.signed_pdf_s3_key,
            r.recipient_email, r.recipient_phone, r.created_at,
            t.name AS template_name, t.category,
            (SELECT json_agg(json_build_object(
                'id', s.id,
                'signer_name', s.signer_name,
                'signature_method', s.signature_method,
                'identity_verified', s.identity_verified,
                'signed_at', s.signed_at,
                'ip_address', s.ip_address,
                'audit_trail_s3_key', s.audit_trail_s3_key
              ) ORDER BY s.signed_at DESC)
               FROM document_signatures s
              WHERE s.signature_request_id = r.id) AS signatures
       FROM document_signature_requests r
       LEFT JOIN practice_document_templates t ON t.id = r.template_id
      WHERE r.id = $1 AND r.practice_id = $2 LIMIT 1`,
    [id, ctx.practiceId],
  )
  if (r.rows.length === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  await auditEhrAccess({ ctx, action: 'document.viewed' as any, resourceType: 'document_signature_request', resourceId: id })
  return NextResponse.json({ request: r.rows[0] })
}
