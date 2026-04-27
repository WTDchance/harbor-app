// app/api/ehr/patients/[id]/letters/[letterId]/pdf/route.ts
//
// Wave 42 / T3 — render a letter to PDF. Mirrors the W38 superbill
// pdf-lib pattern via lib/ehr/letter-render.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
import { renderLetterPdf } from '@/lib/ehr/letter-render'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; letterId: string }> },
) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id: patientId, letterId } = await params

  const [letterRes, ptRes, prRes] = await Promise.all([
    pool.query(
      `SELECT l.*, COALESCE(s.full_name, s.email) AS signed_by_name
         FROM ehr_letters l
         LEFT JOIN users s ON s.id = l.signed_by
        WHERE l.practice_id = $1 AND l.patient_id = $2 AND l.id = $3
        LIMIT 1`,
      [ctx.practiceId, patientId, letterId],
    ),
    pool.query(`SELECT first_name, last_name FROM patients WHERE id = $1 LIMIT 1`, [patientId]),
    pool.query(
      `SELECT name, address_line1, city, state, zip, phone_number AS phone
         FROM practices WHERE id = $1 LIMIT 1`,
      [ctx.practiceId],
    ),
  ])
  const letter = letterRes.rows[0]
  if (!letter) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const bytes = await renderLetterPdf({
    practice: prRes.rows[0] ?? { name: 'Therapy Practice' },
    patient: {
      first_name: ptRes.rows[0]?.first_name ?? null,
      last_name: ptRes.rows[0]?.last_name ?? null,
    },
    letter_kind: letter.kind,
    generated_at: letter.generated_at,
    body_md_resolved: letter.body_md_resolved,
    signed_at: letter.signed_at,
    signed_by_name: letter.signed_by_name ?? null,
  })

  await auditEhrAccess({
    ctx,
    action: 'letter.view',
    resourceType: 'ehr_letter',
    resourceId: letterId,
    details: { patient_id: patientId, kind: letter.kind, format: 'pdf' },
  })

  const filename = `letter-${letter.kind}-${ptRes.rows[0]?.last_name ?? 'patient'}-${letter.id.slice(0, 8)}.pdf`.replace(/\s+/g, '_')
  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
