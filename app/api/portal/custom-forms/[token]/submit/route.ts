// app/api/portal/custom-forms/[token]/submit/route.ts
//
// W49 D1 — patient submits responses. Token-gated. Validates against
// the assignment's schema_snapshot, persists the response, marks the
// assignment 'submitted'.

import { NextResponse, type NextRequest } from 'next/server'
import { pool } from '@/lib/aws/db'
import { writeAuditLog, extractIp } from '@/lib/audit'
import { validateResponse, type CustomFormField } from '@/lib/ehr/custom-forms'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!token || !token.startsWith('cf_')) {
    return NextResponse.json({ error: 'invalid_token' }, { status: 400 })
  }

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const { rows } = await pool.query(
    `SELECT id, practice_id, form_id, patient_id, status,
            token_expires_at, schema_snapshot
       FROM patient_custom_form_assignments
      WHERE token = $1
      LIMIT 1`,
    [token],
  )
  if (rows.length === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const a = rows[0]

  if (new Date(a.token_expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: 'expired' }, { status: 410 })
  }
  if (a.status === 'cancelled') return NextResponse.json({ error: 'cancelled' }, { status: 410 })

  const schema = (a.schema_snapshot ?? []) as CustomFormField[]
  const v = validateResponse(schema, (body as any).response ?? {})
  if (!v.ok) return NextResponse.json({ error: 'invalid_response', message: v.error }, { status: 400 })

  const ip = extractIp(req.headers)
  const ua = req.headers.get('user-agent')

  // Upsert: keep prior responses in `history`.
  await pool.query('BEGIN')
  try {
    const existing = await pool.query(
      `SELECT id, response, history FROM patient_custom_form_responses
        WHERE assignment_id = $1 LIMIT 1`,
      [a.id],
    )
    if (existing.rows.length === 0) {
      await pool.query(
        `INSERT INTO patient_custom_form_responses
           (practice_id, assignment_id, form_id, patient_id, response,
            submitted_ip, submitted_user_agent)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
        [a.practice_id, a.id, a.form_id, a.patient_id,
         JSON.stringify(v.response), ip, ua],
      )
    } else {
      const prev = existing.rows[0]
      const history = Array.isArray(prev.history) ? prev.history : []
      history.push({ response: prev.response, replaced_at: new Date().toISOString() })
      await pool.query(
        `UPDATE patient_custom_form_responses
            SET response = $1::jsonb, history = $2::jsonb,
                submitted_at = NOW(), submitted_ip = $3, submitted_user_agent = $4
          WHERE id = $5`,
        [JSON.stringify(v.response), JSON.stringify(history), ip, ua, prev.id],
      )
    }
    await pool.query(
      `UPDATE patient_custom_form_assignments
          SET status = 'submitted', submitted_at = NOW()
        WHERE id = $1`,
      [a.id],
    )
    await pool.query('COMMIT')
  } catch (e) {
    await pool.query('ROLLBACK').catch(() => null)
    return NextResponse.json({ error: 'persist_failed' }, { status: 500 })
  }

  await writeAuditLog({
    practice_id: a.practice_id,
    action: 'custom_form.response_submitted',
    resource_type: 'patient_custom_form_response',
    resource_id: a.id,
    details: { patient_id: a.patient_id, form_id: a.form_id, ip_present: !!ip },
    ip_address: ip,
    user_agent: ua,
  })

  return NextResponse.json({ ok: true })
}
