// Sign a progress note. Once signed, the note is immutable (subsequent
// PATCHes 409). Amendments sign into status='amended' so the lineage
// stays visible; first-time signatures sign into status='signed'.
//
// Hash algorithm: SHA-256 of the canonical content fields joined with
// the U+241E ('SYMBOL FOR RECORD SEPARATOR') control character. Lifted
// VERBATIM from the legacy implementation -- any future change has to
// match what historical signed notes already hashed against.
//
// Launch-blocker fix #3 (was "AUTO-CHARGE deferred" / "TODO(phase-4b)"):
//   - Mark the linked appointment as completed inside the same TX so the
//     therapist's Today screen reflects reality the moment they sign.
//   - Auto-create ehr_charges rows from the appointment's event_type
//     default_cpt_codes (Wave 49). One charge per CPT. Price comes from
//     practices.default_fee_schedule_cents -> DEFAULT_FEE_CENTS, with
//     applySlidingFee() honouring the patient's fee tier when enabled.
//   - Practices with auto_charge_enabled=false skip auto-charging
//     (column is treated as opt-out: NULL/missing => enabled).
//   - Audit every state change with severity 'info' (NOT 'warn'/'error').

import { NextResponse, type NextRequest } from 'next/server'
import { createHash } from 'node:crypto'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
import { feeForCpt } from '@/lib/aws/billing/calc'
import { applySlidingFee } from '@/lib/aws/billing/sliding-fee'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function contentHash(note: Record<string, any>): string {
  // Stable field order -- match legacy bit-for-bit.
  const parts = [
    note.title || '',
    note.note_format || '',
    note.subjective || '',
    note.objective || '',
    note.assessment || '',
    note.plan || '',
    note.body || '',
    (note.cpt_codes || []).join(','),
    (note.icd10_codes || []).join(','),
  ]
  return createHash('sha256').update(parts.join('␞')).digest('hex')
}

const TERMINAL_APPT_STATUSES = new Set(['completed', 'no_show', 'cancelled'])

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id } = await params

  // Optimistic-lock pattern: load + UPDATE WHERE status='draft' inside a
  // transaction so two concurrent sign requests don't both write a hash.
  const client = await pool.connect()
  let releaseDone = false
  const release = () => { if (!releaseDone) { releaseDone = true; client.release() } }
  try {
    await client.query('BEGIN')

    const noteRes = await client.query(
      `SELECT * FROM ehr_progress_notes
        WHERE id = $1 AND practice_id = $2
        LIMIT 1`,
      [id, ctx.practiceId],
    )
    const note = noteRes.rows[0]
    if (!note) {
      await client.query('ROLLBACK')
      release()
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    if (note.status !== 'draft') {
      await client.query('ROLLBACK')
      release()
      return NextResponse.json(
        { error: `Cannot sign a note in status "${note.status}".` },
        { status: 409 },
      )
    }

    const hasStructured = note.subjective || note.objective || note.assessment || note.plan
    const hasBody = typeof note.body === 'string' && note.body.trim().length > 0
    if (!hasStructured && !hasBody) {
      await client.query('ROLLBACK')
      release()
      return NextResponse.json(
        { error: 'Cannot sign an empty note. Add content in at least one section.' },
        { status: 400 },
      )
    }

    const hash = contentHash(note)
    const nextStatus = note.amendment_of ? 'amended' : 'signed'
    const signedAt = new Date().toISOString()

    const updateRes = await client.query(
      `UPDATE ehr_progress_notes
          SET status = $1,
              signed_at = $2,
              signed_by = $3,
              signature_hash = $4,
              updated_at = NOW()
        WHERE id = $5 AND practice_id = $6 AND status = 'draft'
        RETURNING *`,
      [nextStatus, signedAt, ctx.user.id, hash, id, ctx.practiceId],
    )
    if (!updateRes.rows[0]) {
      // Lost the race to a concurrent sign -- surface the current state.
      await client.query('ROLLBACK')
      release()
      return NextResponse.json(
        { error: 'Note was signed by another request. Reload to see the current state.' },
        { status: 409 },
      )
    }
    const updated = updateRes.rows[0]

    // ── Mark linked appointment completed (inside same TX). ──────────
    let apptStateChange: { id: string; previous: string } | null = null
    if (updated.appointment_id) {
      const apptRes = await client.query(
        `UPDATE appointments
            SET status = 'completed', completed_at = NOW(), updated_at = NOW()
          WHERE id = $1 AND practice_id = $2
            AND status NOT IN ('completed', 'no_show', 'cancelled')
          RETURNING id, status`,
        [updated.appointment_id, ctx.practiceId],
      )
      if (apptRes.rows[0]) {
        apptStateChange = { id: apptRes.rows[0].id, previous: 'pre_completed' }
      }
    }

    // ── Auto-charge from event_type default CPTs. ────────────────────
    // Practices opt out via practices.auto_charge_enabled = false.
    // Schema may not have the column yet -> COALESCE(true) keeps things
    // enabled by default and silently no-ops if the column is missing.
    const autoChargeRows: any[] = []
    let autoChargeSkipped: 'opt_out' | 'no_event_type' | 'no_default_cpts' | 'no_appointment' | null = null

    if (!updated.appointment_id) {
      autoChargeSkipped = 'no_appointment'
    } else {
      // Pull the appointment + event_type defaults + practice billing config.
      const ctxRes = await client.query(
        `SELECT a.id AS appointment_id, a.patient_id, a.event_type_id,
                a.scheduled_for, a.appointment_type, a.cpt_code AS appt_cpt_override,
                et.default_cpt_codes AS default_cpt_codes,
                pr.default_fee_schedule_cents AS fee_schedule
           FROM appointments a
           LEFT JOIN calendar_event_types et ON et.id = a.event_type_id
           LEFT JOIN practices pr ON pr.id = a.practice_id
          WHERE a.id = $1 AND a.practice_id = $2
          LIMIT 1`,
        [updated.appointment_id, ctx.practiceId],
      )
      const apptCtx = ctxRes.rows[0]

      // auto_charge_enabled may be missing on the practices table in
      // older schemas. Treat any error as "enabled" so we never silently
      // suppress charges in environments without the column.
      let autoChargeEnabled = true
      try {
        const pr = await client.query(
          `SELECT COALESCE(auto_charge_enabled, true) AS enabled
             FROM practices WHERE id = $1 LIMIT 1`,
          [ctx.practiceId],
        )
        autoChargeEnabled = pr.rows[0]?.enabled !== false
      } catch {
        autoChargeEnabled = true
      }

      if (!autoChargeEnabled) {
        autoChargeSkipped = 'opt_out'
      } else if (!apptCtx?.event_type_id) {
        autoChargeSkipped = 'no_event_type'
      } else {
        // Prefer the explicit appointment-level CPT override (set when
        // booking telehealth + custom CPT) over the event-type default.
        const cptList: string[] = apptCtx.appt_cpt_override
          ? [String(apptCtx.appt_cpt_override)]
          : (Array.isArray(apptCtx.default_cpt_codes) ? apptCtx.default_cpt_codes.map(String) : [])

        if (cptList.length === 0) {
          autoChargeSkipped = 'no_default_cpts'
        } else {
          const serviceDate = (apptCtx.scheduled_for instanceof Date
            ? apptCtx.scheduled_for
            : new Date(apptCtx.scheduled_for)).toISOString().slice(0, 10)
          const placeOfService = apptCtx.appointment_type === 'telehealth' ? '02' : '11'

          for (const cpt of cptList) {
            const baseFee = feeForCpt(cpt, apptCtx.fee_schedule)
            const sliding = await applySlidingFee({
              client,
              practiceId: ctx.practiceId!,
              patientId: apptCtx.patient_id,
              baseCents: baseFee,
            }).catch(() => ({ adjustedCents: baseFee, tierApplied: null, feePct: null }))

            const ins = await client.query(
              `INSERT INTO ehr_charges (
                 practice_id, patient_id, note_id, appointment_id,
                 cpt_code, units, fee_cents, allowed_cents, copay_cents,
                 billed_to, status, service_date, place_of_service, created_by
               ) VALUES (
                 $1, $2, $3, $4, $5, $6, $7, $8, $9,
                 'insurance', 'pending', $10, $11, $12
               ) RETURNING id, cpt_code, fee_cents`,
              [
                ctx.practiceId,
                apptCtx.patient_id,
                updated.id,
                updated.appointment_id,
                cpt,
                1,
                sliding.adjustedCents,
                sliding.adjustedCents,
                0,
                serviceDate,
                placeOfService,
                ctx.user.id,
              ],
            )
            autoChargeRows.push({
              ...ins.rows[0],
              base_fee_cents: baseFee,
              sliding_fee_tier_applied: sliding.tierApplied,
              sliding_fee_pct: sliding.feePct,
            })
          }
        }
      }
    }

    await client.query('COMMIT')
    release()

    // ── Audit (best-effort, post-commit). Severity 'info' per spec. ──
    await auditEhrAccess({
      ctx,
      action: 'note.sign',
      resourceId: id,
      details: {
        status: nextStatus,
        amendment_of: note.amendment_of ?? null,
        hash,
        appointment_id: updated.appointment_id ?? null,
        appointment_completed: !!apptStateChange,
        auto_charges_created: autoChargeRows.length,
        auto_charge_skipped_reason: autoChargeSkipped,
      },
      severity: 'info',
    })
    if (apptStateChange) {
      await auditEhrAccess({
        ctx,
        action: 'note.sign',
        resourceType: 'appointment',
        resourceId: apptStateChange.id,
        details: { transition: 'to_completed', triggered_by: 'note_sign', note_id: id },
        severity: 'info',
      })
    }
    for (const ch of autoChargeRows) {
      await auditEhrAccess({
        ctx,
        action: 'billing.charge.create',
        resourceType: 'ehr_charge',
        resourceId: ch.id,
        details: {
          kind: 'charge_auto_from_note',
          cpt: ch.cpt_code,
          fee_cents: ch.fee_cents,
          base_fee_cents: ch.base_fee_cents,
          sliding_fee_tier_applied: ch.sliding_fee_tier_applied,
          sliding_fee_pct: ch.sliding_fee_pct,
          note_id: id,
          appointment_id: updated.appointment_id,
        },
        severity: 'info',
      })
    }

    return NextResponse.json({
      note: updated,
      success: true,
      appointment_completed: !!apptStateChange,
      auto_charges: autoChargeRows.map(c => ({ id: c.id, cpt_code: c.cpt_code, fee_cents: c.fee_cents })),
      auto_charge_skipped_reason: autoChargeSkipped,
    })
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    release()
    return NextResponse.json(
      { error: (err as Error).message || 'Internal server error' },
      { status: 500 },
    )
  }
}
