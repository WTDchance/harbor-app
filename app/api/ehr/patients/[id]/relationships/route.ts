// app/api/ehr/patients/[id]/relationships/route.ts
//
// W44 T3 — list + create patient family relationships.
// Symmetric: POST also inserts the inverse row from the related
// patient's side.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
import {
  RELATIONSHIPS,
  inverseRelationship,
  inverseIsMinorConsent,
  type Relationship,
} from '@/lib/aws/ehr/patient-relationships'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  // Confirm patient exists in this practice.
  const pCheck = await pool.query(
    `SELECT id FROM patients WHERE id = $1 AND practice_id = $2`,
    [params.id, ctx.practiceId],
  )
  if (pCheck.rows.length === 0) {
    return NextResponse.json({ error: 'patient_not_found' }, { status: 404 })
  }

  const { rows } = await pool.query(
    `SELECT r.id, r.relationship, r.is_minor_consent, r.notes, r.created_at,
            r.related_patient_id,
            p.first_name AS related_first_name,
            p.last_name  AS related_last_name,
            p.dob        AS related_dob
       FROM ehr_patient_relationships r
       JOIN patients p ON p.id = r.related_patient_id
      WHERE r.practice_id = $1 AND r.patient_id = $2
      ORDER BY r.created_at DESC`,
    [ctx.practiceId, params.id],
  )

  await auditEhrAccess({
    ctx,
    action: 'patient_relationship.viewed',
    resourceType: 'ehr_patient_relationship',
    resourceId: params.id,
    details: { relationship_count: rows.length },
  })

  return NextResponse.json({ relationships: rows })
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'invalid_json' }, { status: 400 })

  const relatedPatientId = String(body.related_patient_id || '')
  const relationship = String(body.relationship || '') as Relationship
  const isMinorConsent = !!body.is_minor_consent
  const notes = body.notes ? String(body.notes).slice(0, 500) : null

  if (!relatedPatientId) {
    return NextResponse.json({ error: 'related_patient_id required' }, { status: 400 })
  }
  if (!RELATIONSHIPS.includes(relationship)) {
    return NextResponse.json({ error: 'invalid relationship' }, { status: 400 })
  }
  if (relatedPatientId === params.id) {
    return NextResponse.json({ error: 'cannot_relate_to_self' }, { status: 400 })
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // Both patients must be in this practice.
    const both = await client.query(
      `SELECT id FROM patients
        WHERE id = ANY($1::uuid[]) AND practice_id = $2`,
      [[params.id, relatedPatientId], ctx.practiceId],
    )
    if (both.rows.length !== 2) {
      await client.query('ROLLBACK')
      return NextResponse.json({ error: 'patient_not_in_practice' }, { status: 404 })
    }

    // Forward row.
    const ins = await client.query(
      `INSERT INTO ehr_patient_relationships
         (practice_id, patient_id, related_patient_id,
          relationship, is_minor_consent, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (practice_id, patient_id, related_patient_id, relationship)
         DO UPDATE SET is_minor_consent = EXCLUDED.is_minor_consent,
                       notes = EXCLUDED.notes
       RETURNING id`,
      [
        ctx.practiceId,
        params.id,
        relatedPatientId,
        relationship,
        isMinorConsent,
        notes,
        ctx.user.id,
      ],
    )

    // Inverse row (symmetry). Don't trip if the inverse already exists.
    const inverse = inverseRelationship(relationship)
    await client.query(
      `INSERT INTO ehr_patient_relationships
         (practice_id, patient_id, related_patient_id,
          relationship, is_minor_consent, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (practice_id, patient_id, related_patient_id, relationship)
         DO NOTHING`,
      [
        ctx.practiceId,
        relatedPatientId,
        params.id,
        inverse,
        inverseIsMinorConsent(),
        notes,
        ctx.user.id,
      ],
    )

    await client.query('COMMIT')

    await auditEhrAccess({
      ctx,
      action: 'patient_relationship.added',
      resourceType: 'ehr_patient_relationship',
      resourceId: ins.rows[0].id,
      details: {
        relationship,
        inverse_relationship: inverse,
        is_minor_consent: isMinorConsent,
      },
    })

    return NextResponse.json({ relationship_id: ins.rows[0].id }, { status: 201 })
  } catch (err) {
    try { await client.query('ROLLBACK') } catch {}
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  } finally {
    client.release()
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const sp = req.nextUrl.searchParams
  const relationshipId = sp.get('relationship_id')
  if (!relationshipId) {
    return NextResponse.json({ error: 'relationship_id required' }, { status: 400 })
  }

  // Look up the row to find the inverse to delete too.
  const cur = await pool.query(
    `SELECT patient_id, related_patient_id, relationship
       FROM ehr_patient_relationships
      WHERE id = $1 AND practice_id = $2 AND patient_id = $3
      LIMIT 1`,
    [relationshipId, ctx.practiceId, params.id],
  )
  if (cur.rows.length === 0) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  const row = cur.rows[0]
  const inv = inverseRelationship(row.relationship as Relationship)

  // Delete forward + inverse rows.
  await pool.query(
    `DELETE FROM ehr_patient_relationships
      WHERE practice_id = $1
        AND ((patient_id = $2 AND related_patient_id = $3)
          OR (patient_id = $3 AND related_patient_id = $2 AND relationship = $4))`,
    [ctx.practiceId, row.patient_id, row.related_patient_id, inv],
  )

  await auditEhrAccess({
    ctx,
    action: 'patient_relationship.removed',
    resourceType: 'ehr_patient_relationship',
    resourceId: relationshipId,
    details: { relationship: row.relationship },
  })

  return NextResponse.json({ ok: true })
}
