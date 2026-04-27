// app/api/ehr/patients/[id]/letters/[letterId]/sign/route.ts
//
// Wave 42 / T3 — therapist signs a generated letter. Once signed,
// signed_at + signed_by are set; the letter row is otherwise
// immutable. Re-signing a signed letter is a no-op (audit fires
// once on first sign only).

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; letterId: string }> },
) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id: patientId, letterId } = await params

  const { rows } = await pool.query(
    `UPDATE ehr_letters
        SET signed_at = NOW(), signed_by = $1
      WHERE practice_id = $2 AND patient_id = $3 AND id = $4
        AND signed_at IS NULL
      RETURNING *`,
    [ctx.user.id, ctx.practiceId, patientId, letterId],
  )

  if (rows.length === 0) {
    // Either not found or already signed.
    const cur = await pool.query(
      `SELECT signed_at FROM ehr_letters
        WHERE practice_id = $1 AND patient_id = $2 AND id = $3 LIMIT 1`,
      [ctx.practiceId, patientId, letterId],
    )
    if (cur.rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(
      { error: { code: 'already_signed', message: 'Letter is already signed.' } },
      { status: 409 },
    )
  }

  await auditEhrAccess({
    ctx,
    action: 'letter.sign',
    resourceType: 'ehr_letter',
    resourceId: letterId,
    details: { patient_id: patientId, kind: rows[0].kind },
  })

  return NextResponse.json({ letter: rows[0] })
}
