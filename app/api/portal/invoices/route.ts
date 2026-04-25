// Patient portal — invoices for the signed-in patient.

import { NextResponse } from 'next/server'
import { requirePortalSession } from '@/lib/aws/portal-auth'
import { pool } from '@/lib/aws/db'
import { auditPortalAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const sess = await requirePortalSession()
  if (sess instanceof NextResponse) return sess

  const { rows } = await pool.query(
    `SELECT id, total_cents, paid_cents, status, stripe_payment_url,
            sent_at, paid_at, due_date, created_at
       FROM ehr_invoices
      WHERE practice_id = $1 AND patient_id = $2
      ORDER BY created_at DESC`,
    [sess.practiceId, sess.patientId],
  )

  auditPortalAccess({
    session: sess,
    action: 'portal.invoice.list',
    resourceType: 'ehr_invoice',
    details: { count: rows.length },
  }).catch(() => {})

  return NextResponse.json({ invoices: rows })
}
