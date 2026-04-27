// app/api/ehr/consent-documents/route.ts
//
// Wave 38 TS4 — therapist creates or seeds versioned consent documents
// for the practice. The portal /api/portal/consents reads these.

import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/aws/db'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const VALID_KINDS = new Set(['hipaa_npp', 'telehealth', 'financial_responsibility', 'roi', '42_cfr_part2'])

export async function GET(_req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { rows } = await pool.query(
    `SELECT id, kind, version, body_md, required, effective_at, created_at
       FROM consent_documents
      WHERE practice_id = $1
      ORDER BY kind ASC, effective_at DESC`,
    [ctx.practiceId],
  )
  return NextResponse.json({ documents: rows })
}

export async function POST(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const body = await req.json().catch(() => null) as any
  const kind = String(body?.kind || '')
  const version = String(body?.version || 'v1')
  const bodyMd = String(body?.body_md || '')
  const required = body?.required === undefined ? true : !!body.required
  if (!VALID_KINDS.has(kind)) {
    return NextResponse.json({ error: 'invalid kind' }, { status: 400 })
  }
  if (bodyMd.length < 10) {
    return NextResponse.json({ error: 'body_md too short' }, { status: 400 })
  }

  const ins = await pool.query(
    `INSERT INTO consent_documents (practice_id, kind, version, body_md, required)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [ctx.practiceId, kind, version, bodyMd, required],
  )
  await auditEhrAccess({
    ctx,
    action: 'consent.create',
    resourceType: 'consent_document',
    resourceId: ins.rows[0].id,
    details: { kind, version, required },
  })
  return NextResponse.json({ document: ins.rows[0] }, { status: 201 })
}
