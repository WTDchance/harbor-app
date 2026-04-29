// app/api/ehr/patients/bulk-flags/route.ts
//
// W50 D1 — bulk-fetch active flag types for many patients in one round-trip.
// Used by the patient list to render PatientFlagChips per row without
// firing N+1 GET /flags calls.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const body = await req.json().catch(() => null) as { patient_ids?: string[] } | null
  const ids = Array.isArray(body?.patient_ids)
    ? body.patient_ids.filter((s): s is string => typeof s === 'string').slice(0, 500)
    : []
  if (ids.length === 0) return NextResponse.json({ flags: {} })

  const { rows } = await pool.query(
    `SELECT patient_id::text AS patient_id,
            array_agg(DISTINCT type) AS types
       FROM patient_flags
      WHERE practice_id = $1
        AND patient_id = ANY($2::uuid[])
        AND cleared_at IS NULL
      GROUP BY patient_id`,
    [ctx.practiceId, ids],
  )

  const flags: Record<string, string[]> = {}
  for (const r of rows) flags[r.patient_id] = r.types ?? []
  return NextResponse.json({ flags })
}
