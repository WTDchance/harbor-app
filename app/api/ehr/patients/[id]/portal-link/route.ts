// app/api/ehr/patients/[id]/portal-link/route.ts
//
// Wave 22 (AWS port). Therapist-side: rotate the portal access token
// for a patient. Returns the full login URL.

import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/aws/db'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
import { newPortalToken } from '@/lib/aws/portal-auth'

const TOKEN_TTL_DAYS = 30

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id: patientId } = await params

  const { rows: pRows } = await pool.query(
    `SELECT id FROM patients
      WHERE id = $1 AND practice_id = $2 AND deleted_at IS NULL LIMIT 1`,
    [patientId, ctx.practiceId],
  )
  if (pRows.length === 0) return NextResponse.json({ error: 'Patient not found' }, { status: 404 })

  const token = newPortalToken()
  const expiresAt = new Date(Date.now() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString()

  try {
    await pool.query(
      `UPDATE patients
          SET portal_access_token = $1,
              portal_token_expires_at = $2
        WHERE id = $3 AND practice_id = $4`,
      [token, expiresAt, patientId, ctx.practiceId],
    )
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }

  const base = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin
  const url = `${base}/portal/login?token=${encodeURIComponent(token)}`

  await auditEhrAccess({
    ctx,
    action: 'note.update',
    resourceType: 'patient',
    resourceId: patientId,
    details: { kind: 'portal_token_rotated', expires_at: expiresAt },
  })

  return NextResponse.json({ url, token, expires_at: expiresAt })
}
