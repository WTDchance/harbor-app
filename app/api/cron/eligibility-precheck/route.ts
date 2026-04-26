// Batch insurance-eligibility pre-check.
//
// Called by an external cron daily (cron-job.org). Looks 7 days ahead, finds
// every scheduled appointment, and re-verifies each patient's insurance if
// their last check is stale. Results land in eligibility_checks and advance
// insurance_records.last_verified_at / next_verify_due.
//
// Auth: Authorization: Bearer <CRON_SECRET> (or x-cron-secret).

import { NextResponse, type NextRequest } from 'next/server'
import { pool } from '@/lib/aws/db'
import { runAndPersistEligibilityCheck } from '@/lib/aws/stedi/eligibility'
import { auditSystemEvent } from '@/lib/aws/ehr/audit'
import { assertCronAuthorized } from '@/lib/cron-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const LOOKAHEAD_DAYS = 7
const STEDI_THROTTLE_MS = 300
const MAX_CHECKS_PER_RUN = 200

export async function POST(req: NextRequest) {
  const started = Date.now()
  const unauthorized = assertCronAuthorized(req)
  if (unauthorized) return unauthorized

  try {
    const nowIso = new Date().toISOString()
    const horizonIso = new Date(Date.now() + LOOKAHEAD_DAYS * 86_400_000).toISOString()

    // Upcoming scheduled appointments, deduped by (practice_id, patient_id).
    // AWS canonical: scheduled_for replaces scheduled_at.
    const { rows: appts } = await pool.query(
      `SELECT id, practice_id, patient_id
         FROM appointments
        WHERE status = 'scheduled'
          AND scheduled_for >= $1 AND scheduled_for <= $2
          AND patient_id IS NOT NULL`,
      [nowIso, horizonIso],
    )
    const uniquePairs = new Map<string, { practiceId: string; patientId: string }>()
    for (const a of appts) {
      const key = `${a.practice_id}:${a.patient_id}`
      if (!uniquePairs.has(key)) {
        uniquePairs.set(key, { practiceId: a.practice_id, patientId: a.patient_id })
      }
    }

    // Skip self-pay / sliding-scale patients — schema-gap-aware: AWS canonical
    // patients doesn't yet have billing_mode in every cluster, so default to
    // 'pending' on missing column.
    let skippedByBillingMode = 0
    const patientIdsConsidered = Array.from(uniquePairs.values()).map(v => v.patientId)
    if (patientIdsConsidered.length > 0) {
      try {
        const { rows: billingRows } = await pool.query(
          `SELECT id, billing_mode FROM patients WHERE id = ANY($1::uuid[])`,
          [patientIdsConsidered],
        )
        const modeById = new Map<string, string>()
        for (const r of billingRows) modeById.set(r.id, r.billing_mode || 'pending')
        for (const [key, pair] of uniquePairs) {
          const mode = modeById.get(pair.patientId) || 'pending'
          if (mode !== 'insurance' && mode !== 'pending') {
            uniquePairs.delete(key)
            skippedByBillingMode++
          }
        }
      } catch {
        // billing_mode column may not exist yet — skip the filter rather than 500.
      }
    }

    const considered = uniquePairs.size
    let verified = 0
    let skipped = 0
    const errors: Array<{ patient_id: string; reason: string }> = []

    let count = 0
    for (const { practiceId, patientId } of uniquePairs.values()) {
      if (count >= MAX_CHECKS_PER_RUN) break
      count++

      try {
        const insuranceRow = await pool.query(
          `SELECT id, insurance_company, member_id, group_number,
                  subscriber_name, subscriber_dob, patient_name, patient_dob,
                  patient_phone, last_verified_at, next_verify_due
             FROM insurance_records
            WHERE practice_id = $1 AND patient_id = $2
            ORDER BY updated_at DESC LIMIT 1`,
          [practiceId, patientId],
        )
        const ir = insuranceRow.rows[0]
        if (!ir) { skipped++; continue }

        const dueByDate = ir.next_verify_due ? new Date(ir.next_verify_due) : null
        if (ir.last_verified_at && dueByDate && dueByDate > new Date()) {
          skipped++
          continue
        }

        const practiceRow = await pool.query(
          `SELECT id, name, npi FROM practices WHERE id = $1 LIMIT 1`,
          [practiceId],
        )
        const practice = practiceRow.rows[0]
        if (!practice) { skipped++; continue }

        await runAndPersistEligibilityCheck({
          insuranceRecordId: ir.id,
          practice: { id: practice.id, name: practice.name, npi: practice.npi ?? null },
          patient: {
            name: ir.patient_name || '',
            dob: ir.patient_dob || null,
            phone: ir.patient_phone || null,
          },
          insurance: {
            company: ir.insurance_company,
            memberId: ir.member_id || null,
            groupNumber: ir.group_number || null,
          },
          subscriber: {
            name: ir.subscriber_name || null,
            dob: ir.subscriber_dob || null,
          },
          triggerSource: 'batch_precheck',
        })
        verified++

        if (count < uniquePairs.size && count < MAX_CHECKS_PER_RUN) {
          await new Promise(r => setTimeout(r, STEDI_THROTTLE_MS))
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'unknown'
        console.error(`[eligibility-precheck] patient ${patientId}: ${reason}`)
        errors.push({ patient_id: patientId, reason })
      }
    }

    auditSystemEvent({
      action: 'cron.eligibility-precheck.run',
      details: {
        considered, verified, skipped, skipped_by_billing_mode: skippedByBillingMode,
        error_count: errors.length, duration_ms: Date.now() - started,
      },
    }).catch(() => {})

    return NextResponse.json({
      ok: true,
      considered, verified, skipped,
      skipped_by_billing_mode: skippedByBillingMode,
      errors: errors.length,
      errorDetail: errors.slice(0, 10),
      durationMs: Date.now() - started,
    })
  } catch (err) {
    console.error('[eligibility-precheck]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'internal error' },
      { status: 500 },
    )
  }
}
