// app/api/cron/eligibility-precheck/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { runAndPersistEligibilityCheck } from '@/lib/stedi/eligibility'
import { assertCronAuthorized } from '@/lib/cron-auth'

/**
 * Batch insurance-eligibility pre-check.
 *
 * Called by an external cron (cron-job.org) daily. Looks 7 days ahead, finds
 * every scheduled appointment, and re-verifies each patient's insurance if
 * their last check is stale. Results land in eligibility_checks and advance
 * insurance_records.last_verified_at / next_verify_due.
 *
 * Auth: Authorization: Bearer <CRON_SECRET>
 *
 * Response:
 *   { ok, considered, verified, skipped, errors, durationMs }
 */

const LOOKAHEAD_DAYS = 7
const STEDI_THROTTLE_MS = 300       // Stedi recommends ~300ms between calls
const MAX_CHECKS_PER_RUN = 200      // safety cap; prod practices will be well under this

export async function POST(req: NextRequest) {
  const started = Date.now()
  try {
    const unauthorized = assertCronAuthorized(req)
    if (unauthorized) return unauthorized

    const nowIso = new Date().toISOString()
    const horizonIso = new Date(Date.now() + LOOKAHEAD_DAYS * 86_400_000).toISOString()

    // --- find upcoming appointments ---
    // Only status='scheduled'; completed/cancelled/no-show don't need verification.
    const { data: appts, error: apptErr } = await supabaseAdmin
      .from('appointments')
      .select('id, practice_id, patient_id, scheduled_at')
      .eq('status', 'scheduled')
      .gte('scheduled_at', nowIso)
      .lte('scheduled_at', horizonIso)

    if (apptErr) throw apptErr

    // Deduplicate to one entry per (practice_id, patient_id). Re-verifying the
    // same patient twice in one run would be pointless.
    const uniquePairs = new Map<string, { practiceId: string; patientId: string }>()
    for (const a of appts || []) {
      if (!a.patient_id) continue
      const key = `${a.practice_id}:${a.patient_id}`
      if (!uniquePairs.has(key)) {
        uniquePairs.set(key, { practiceId: a.practice_id, patientId: a.patient_id })
      }
    }

    const considered = uniquePairs.size
    let verified = 0
    let skipped = 0
    const errors: Array<{ patient_id: string; reason: string }> = []

    // --- per-patient check ---
    let count = 0
    for (const { practiceId, patientId } of uniquePairs.values()) {
      if (count >= MAX_CHECKS_PER_RUN) break
      count++

      try {
        // Most recently updated insurance record for this patient.
        const { data: ir } = await supabaseAdmin
          .from('insurance_records')
          .select('id, insurance_company, member_id, group_number, subscriber_name, subscriber_dob, patient_name, patient_dob, patient_phone, last_verified_at, next_verify_due')
          .eq('practice_id', practiceId)
          .eq('patient_id', patientId)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (!ir) {
          skipped++
          continue
        }

        // Skip if recently verified and not due yet.
        const dueByDate = ir.next_verify_due ? new Date(ir.next_verify_due) : null
        if (ir.last_verified_at && dueByDate && dueByDate > new Date()) {
          skipped++
          continue
        }

        const { data: practice } = await supabaseAdmin
          .from('practices')
          .select('id, name, npi')
          .eq('id', practiceId)
          .single()
        if (!practice) {
          skipped++
          continue
        }

        await runAndPersistEligibilityCheck(supabaseAdmin, {
          insuranceRecordId: ir.id,
          practice: { id: practice.id, name: practice.name, npi: practice.npi },
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

        // Throttle before the next Stedi call. Skip the sleep on the last iter.
        if (count < uniquePairs.size && count < MAX_CHECKS_PER_RUN) {
          await new Promise(r => setTimeout(r, STEDI_THROTTLE_MS))
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'unknown'
        console.error(`[eligibility-precheck] patient ${patientId}: ${reason}`)
        errors.push({ patient_id: patientId, reason })
      }
    }

    return NextResponse.json({
      ok: true,
      considered,
      verified,
      skipped,
      errors: errors.length,
      errorDetail: errors.slice(0, 10),
      durationMs: Date.now() - started,
    })
  } catch (err) {
    console.error('[eligibility-precheck]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'internal error' },
      { status: 500 }
    )
  }
}
