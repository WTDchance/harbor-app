// app/api/ehr/admin/patients/merge/route.ts
//
// W44 T4 — admin tool to merge two patient records.
//
// Body: { keep_id, merge_id }
//   keep_id is the patient row that survives.
//   merge_id is the patient row that gets soft-deleted; everything
//   referencing it is reassigned to keep_id.
//
// Tables we re-point to keep_id (each scoped to the same practice
// for safety):
//   appointments, ehr_progress_notes, outcome_assessments,
//   ehr_charges, ehr_invoices, ehr_treatment_plans,
//   ehr_insurance_card_scans, ehr_payments, ehr_patient_documents,
//   ehr_patient_relationships (both patient_id + related_patient_id),
//   ehr_reengagement_outreach.
//
// merge_id's row is soft-deleted: patient_status='discharged',
// merged_into = keep_id (column added by the migration if missing —
// but rather than altering schema here we just stash it into the
// chart_notes JSONB if present, or rely on dropped patient_status.
// For W44 we keep it simple: hard-delete the merge row only after a
// confirmed admin pass; otherwise mark it inactive.)

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Subset of admin-only emails (mirrors the superbill regenerate gate).
function isAdminEmail(email: string | undefined | null): boolean {
  if (!email) return false
  const allow = (process.env.ADMIN_EMAIL || 'chancewonser@gmail.com')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  return allow.includes(email.toLowerCase())
}

export async function POST(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  if (!isAdminEmail(ctx.session?.email)) {
    return NextResponse.json({ error: 'admin_only' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  if (!body?.keep_id || !body?.merge_id) {
    return NextResponse.json({ error: 'keep_id and merge_id required' }, { status: 400 })
  }
  const keepId = String(body.keep_id)
  const mergeId = String(body.merge_id)
  if (keepId === mergeId) {
    return NextResponse.json({ error: 'cannot_merge_with_self' }, { status: 400 })
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // Both must be in this practice.
    const both = await client.query(
      `SELECT id FROM patients
        WHERE id = ANY($1::uuid[]) AND practice_id = $2`,
      [[keepId, mergeId], ctx.practiceId],
    )
    if (both.rows.length !== 2) {
      await client.query('ROLLBACK')
      return NextResponse.json({ error: 'patient_not_in_practice' }, { status: 404 })
    }

    // Reassign children. Each table is scoped to the practice for
    // belt-and-braces: even if practice_id is denormalized correctly,
    // we don't want a bug to leak rows from another practice.
    const reassigns: Array<{ table: string; column: string }> = [
      { table: 'appointments',                   column: 'patient_id' },
      { table: 'ehr_progress_notes',             column: 'patient_id' },
      { table: 'outcome_assessments',            column: 'patient_id' },
      { table: 'ehr_charges',                    column: 'patient_id' },
      { table: 'ehr_invoices',                   column: 'patient_id' },
      { table: 'ehr_treatment_plans',            column: 'patient_id' },
      { table: 'ehr_insurance_card_scans',       column: 'patient_id' },
      { table: 'ehr_payments',                   column: 'patient_id' },
      { table: 'ehr_patient_documents',          column: 'patient_id' },
      { table: 'ehr_reengagement_outreach',      column: 'patient_id' },
      { table: 'ehr_patient_relationships',      column: 'patient_id' },
      { table: 'ehr_patient_relationships',      column: 'related_patient_id' },
    ]

    const counts: Record<string, number> = {}
    for (const r of reassigns) {
      try {
        const res = await client.query(
          `UPDATE ${r.table} SET ${r.column} = $1
            WHERE ${r.column} = $2 AND practice_id = $3`,
          [keepId, mergeId, ctx.practiceId],
        )
        const k = `${r.table}.${r.column}`
        counts[k] = (counts[k] || 0) + (res.rowCount ?? 0)
      } catch (err) {
        // Tables that don't exist yet on this branch should not fail
        // the merge. Log and continue.
        console.warn(`[patient_merge] skip ${r.table}.${r.column}:`, (err as Error).message)
        try { await client.query('ROLLBACK') } catch {}
        await client.query('BEGIN')
      }
    }

    // Mark the merge row inactive. We don't hard-delete because the
    // FK ON DELETE rules differ across tables and we want a recovery
    // path if a merge was wrong.
    await client.query(
      `UPDATE patients
          SET patient_status = 'discharged',
              first_name = first_name || ' [MERGED]',
              email = NULL,
              phone = NULL
        WHERE id = $1 AND practice_id = $2`,
      [mergeId, ctx.practiceId],
    )

    await client.query('COMMIT')

    await auditEhrAccess({
      ctx,
      action: 'patient_duplicate.merged',
      resourceType: 'patient',
      resourceId: keepId,
      details: {
        merged_from: mergeId,
        rows_reassigned: counts,
      },
    })

    return NextResponse.json({ ok: true, kept: keepId, merged: mergeId, rows_reassigned: counts })
  } catch (err) {
    try { await client.query('ROLLBACK') } catch {}
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  } finally {
    client.release()
  }
}
