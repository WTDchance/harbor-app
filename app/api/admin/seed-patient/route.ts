// app/api/admin/seed-patient/route.ts
//
// Wave 18 (AWS port). Admin-only: seed or remove a patient row under
// any practice so Ellie / intake / reminder flows have someone to
// recognize. Used to prep the Harbor Demo practice with a known
// patient for end-to-end demo calls.
//
// Auth: requireAdminSession() — Cognito session must match
// ADMIN_EMAIL allowlist.
//
// POST   { practice_id, first_name, phone, ...optional } — upsert by
//        (practice_id, phone). Refreshes name/email/DOB so re-running
//        is safe.
// DELETE { practice_id, patient_id? | phone? } — soft-delete by
//        setting deleted_at = NOW (NOT hard delete — patient rows are
//        PHI and should be recoverable for HIPAA right-of-access).
//
// Audit captures admin email + practice_id + payload hash.

import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/aws/db'
import { requireAdminSession } from '@/lib/aws/api-auth'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
import { hashAdminPayload } from '@/lib/aws/admin/payload-hash'

interface SeedBody {
  practice_id?: string
  first_name?: string
  last_name?: string
  phone?: string
  email?: string
  date_of_birth?: string
  notes?: string
}

export async function POST(req: NextRequest) {
  const ctx = await requireAdminSession()
  if (ctx instanceof NextResponse) return ctx

  let body: SeedBody
  try {
    body = (await req.json()) as SeedBody
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const { practice_id, first_name, last_name, phone, email, date_of_birth, notes } = body
  if (!practice_id || !first_name || !phone) {
    return NextResponse.json(
      { error: 'practice_id, first_name, phone are required' },
      { status: 400 },
    )
  }

  // Verify practice exists.
  const { rows: pRows } = await pool.query(
    `SELECT id, name FROM practices WHERE id = $1 LIMIT 1`,
    [practice_id],
  )
  if (pRows.length === 0) {
    return NextResponse.json({ error: 'practice not found' }, { status: 404 })
  }

  // Existing (practice_id, phone) row?
  const { rows: existRows } = await pool.query(
    `SELECT id FROM patients
      WHERE practice_id = $1 AND phone = $2 AND deleted_at IS NULL
      LIMIT 1`,
    [practice_id, phone],
  )

  let patient: any
  let created = false
  if (existRows[0]) {
    const upd = await pool.query(
      `UPDATE patients
          SET first_name = $1,
              last_name = $2,
              email = $3,
              date_of_birth = $4
        WHERE id = $5
        RETURNING *`,
      [first_name, last_name ?? null, email ?? null, date_of_birth ?? null, existRows[0].id],
    )
    patient = upd.rows[0]
  } else {
    const ins = await pool.query(
      `INSERT INTO patients
        (practice_id, first_name, last_name, phone, email, date_of_birth)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [practice_id, first_name, last_name ?? null, phone, email ?? null, date_of_birth ?? null],
    )
    patient = ins.rows[0]
    created = true
  }

  await auditEhrAccess({
    ctx,
    action: 'admin.seed_patient',
    resourceType: 'patient',
    resourceId: patient.id,
    details: {
      admin_email: ctx.session.email,
      target_practice_id: practice_id,
      created,
      payload_hash: hashAdminPayload(body),
      notes_preserved: notes ?? null,
    },
  })

  return NextResponse.json({ ok: true, created, patient })
}

export async function DELETE(req: NextRequest) {
  const ctx = await requireAdminSession()
  if (ctx instanceof NextResponse) return ctx

  let body: { practice_id?: string; patient_id?: string; phone?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const { practice_id, patient_id, phone } = body
  if (!practice_id) {
    return NextResponse.json({ error: 'practice_id is required' }, { status: 400 })
  }
  if (!patient_id && !phone) {
    return NextResponse.json(
      { error: 'patient_id or phone is required to identify the row' },
      { status: 400 },
    )
  }

  // Soft-delete: set deleted_at instead of hard removing the row.
  const params: any[] = [practice_id]
  let where = `practice_id = $1 AND deleted_at IS NULL`
  if (patient_id) {
    params.push(patient_id)
    where += ` AND id = $${params.length}`
  } else if (phone) {
    params.push(phone)
    where += ` AND phone = $${params.length}`
  }

  const { rows } = await pool.query(
    `UPDATE patients SET deleted_at = NOW()
      WHERE ${where}
      RETURNING id, first_name, last_name`,
    params,
  )

  await auditEhrAccess({
    ctx,
    action: 'admin.seed_patient',
    resourceType: 'patient',
    resourceId: rows[0]?.id ?? null,
    details: {
      admin_email: ctx.session.email,
      target_practice_id: practice_id,
      action: 'soft_delete',
      deleted_count: rows.length,
      payload_hash: hashAdminPayload(body),
    },
  })

  return NextResponse.json({ ok: true, deleted: rows.length, rows })
}
