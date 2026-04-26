// Public token-auth — validates an intake token and returns the practice
// info the patient-facing form needs to render. No DB writes.

import { NextResponse, type NextRequest } from 'next/server'
import { pool } from '@/lib/aws/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  if (!token) return NextResponse.json({ error: 'Missing token' }, { status: 400 })

  // intake_forms.token + practice join.
  const lookup = await pool.query(
    `SELECT f.id, f.practice_id, f.patient_name, f.patient_phone,
            f.patient_email, f.status, f.expires_at, f.created_at,
            p.name AS practice_name
       FROM intake_forms f
       LEFT JOIN practices p ON p.id = f.practice_id
      WHERE f.token = $1
      LIMIT 1`,
    [token],
  ).catch(() => ({ rows: [] as any[] }))

  const form = lookup.rows[0]
  if (!form) return NextResponse.json({ error: 'Invalid token' }, { status: 404 })

  return NextResponse.json({
    id: form.id,
    practice_id: form.practice_id,
    practice: { id: form.practice_id, name: form.practice_name ?? null },
    patient_name: form.patient_name,
    patient_phone: form.patient_phone,
    patient_email: form.patient_email,
    status: form.status,
    expires_at: form.expires_at,
    created_at: form.created_at,
    valid: form.status === 'pending' && new Date(form.expires_at) > new Date(),
  })
}
