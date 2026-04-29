// app/api/portal/custom-forms/[token]/route.ts
//
// W49 D1 — patient-facing GET. Returns the snapshot schema + form
// metadata so the portal page can render the form. Token-gated; no
// portal session required.

import { NextResponse, type NextRequest } from 'next/server'
import { pool } from '@/lib/aws/db'
import { writeAuditLog } from '@/lib/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!token || !token.startsWith('cf_')) {
    return NextResponse.json({ error: 'invalid_token' }, { status: 400 })
  }

  const { rows } = await pool.query(
    `SELECT a.id, a.practice_id, a.form_id, a.patient_id, a.status,
            a.token_expires_at, a.schema_snapshot, a.submitted_at,
            f.name AS form_name, f.description AS form_description,
            p.first_name AS patient_first_name, p.last_name AS patient_last_name,
            pr.name AS practice_name
       FROM patient_custom_form_assignments a
       JOIN practice_custom_forms f ON f.id = a.form_id
       JOIN patients p              ON p.id = a.patient_id
       JOIN practices pr            ON pr.id = a.practice_id
      WHERE a.token = $1
      LIMIT 1`,
    [token],
  )
  if (rows.length === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const row = rows[0]

  if (new Date(row.token_expires_at).getTime() < Date.now() || row.status === 'expired') {
    // Lazy mark expired without blocking response.
    await pool.query(
      `UPDATE patient_custom_form_assignments SET status = 'expired'
        WHERE id = $1 AND status NOT IN ('submitted','cancelled')`,
      [row.id],
    ).catch(() => null)
    return NextResponse.json({ error: 'expired' }, { status: 410 })
  }
  if (row.status === 'cancelled') {
    return NextResponse.json({ error: 'cancelled' }, { status: 410 })
  }

  // Mark "opened" the first time the patient hits this endpoint.
  if (row.status === 'sent') {
    await pool.query(
      `UPDATE patient_custom_form_assignments
          SET status = 'opened', opened_at = NOW()
        WHERE id = $1 AND status = 'sent'`,
      [row.id],
    ).catch(() => null)
    await writeAuditLog({
      practice_id: row.practice_id,
      action: 'custom_form.assignment_opened',
      resource_type: 'patient_custom_form_assignment',
      resource_id: row.id,
      details: { token_prefix: token.slice(0, 8) },
    })
  }

  return NextResponse.json({
    assignment: {
      id: row.id,
      status: row.status === 'sent' ? 'opened' : row.status,
      schema: row.schema_snapshot,
      submitted_at: row.submitted_at,
    },
    form: { name: row.form_name, description: row.form_description },
    patient: { first_name: row.patient_first_name, last_name: row.patient_last_name },
    practice: { name: row.practice_name },
  })
}
