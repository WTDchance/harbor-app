// app/api/dashboard/today/route.ts
//
// Wave 36 — consolidated data feed for the Today screen. Returns:
//   - today's appointments (joined with patient name + note status)
//   - attention items (notes-pending-sign, crisis flags, unread messages,
//     consents about to expire, missed calls), each with WHY they need attention
//   - recent activity feed (last 10 patient interactions across the practice)
//   - greeting + headline counts
//
// Single round-trip; everything runs in parallel via pool.

import { NextResponse, type NextRequest } from 'next/server'
import { pool } from '@/lib/aws/db'
import { requireApiSession } from '@/lib/aws/api-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function greeting(now = new Date()): string {
  const h = now.getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

export async function GET(_req: NextRequest) {
  const ctx = await requireApiSession()
  if (ctx instanceof NextResponse) return ctx
  const practiceId = ctx.practiceId
  if (!practiceId) return NextResponse.json({ error: 'no_practice' }, { status: 403 })

  // Pull everything in parallel
  const [
    practiceRow,
    appointments,
    overdueAssessments,
    treatmentPlanReviews,
    unsignedNotes,
    missingConsents,
    apptsMissingNote,
    activity,
    highRiskPatients,
    stalePreauthRequests,
    rejectedClaims,
  ] = await Promise.all([
    pool.query(
      `SELECT name FROM practices WHERE id = $1 LIMIT 1`,
      [practiceId],
    ),
    pool.query(
      `SELECT
         a.id, a.patient_id, a.scheduled_for,
         a.duration_minutes, a.appointment_type, a.status,
         a.telehealth_room_slug, a.video_provider, a.video_meeting_id,
         p.first_name AS patient_first_name,
         p.last_name  AS patient_last_name,
         p.intake_completed,
         (SELECT n.status FROM ehr_progress_notes n
           WHERE n.appointment_id = a.id
           ORDER BY n.created_at DESC LIMIT 1) AS note_status
       FROM appointments a
       LEFT JOIN patients p ON p.id = a.patient_id
       WHERE a.practice_id = $1
         AND a.scheduled_for >= date_trunc('day', NOW())
         AND a.scheduled_for <  date_trunc('day', NOW()) + INTERVAL '1 day'
         AND a.status IN ('scheduled', 'confirmed', 'in_progress')
       ORDER BY a.scheduled_for ASC`,
      [practiceId],
    ).catch(() => ({ rows: [] as any[] })),
    // 1. Active patients with last assessment > 365 days (or never assessed
    //    at all). "Active" = patient_status not in ('inactive','discharged')
    //    and last_contact_at within the last 180 days, so we don't surface
    //    stale leads or discharged patients. Annual reassessment is the
    //    standard rhythm for outcomes-tracking practices.
    pool.query(
      `SELECT p.id AS patient_id,
              p.first_name || ' ' || p.last_name AS patient_name,
              MAX(pa.completed_at) AS last_assessment_at
         FROM patients p
         LEFT JOIN patient_assessments pa
           ON pa.patient_id = p.id AND pa.status = 'completed'
        WHERE p.practice_id = $1
          AND COALESCE(p.patient_status, 'active') NOT IN ('inactive','discharged','archived')
          AND (p.last_contact_at IS NULL OR p.last_contact_at > NOW() - INTERVAL '180 days')
        GROUP BY p.id, p.first_name, p.last_name
       HAVING MAX(pa.completed_at) IS NULL
           OR MAX(pa.completed_at) < NOW() - INTERVAL '365 days'
        ORDER BY last_assessment_at NULLS FIRST
        LIMIT 5`,
      [practiceId],
    ).catch(() => ({ rows: [] as any[] })),

    // 2. Treatment plans whose review_date is today/past, OR an active plan
    //    whose review_date is NULL but it's been active >90 days (so the
    //    therapist hasn't set a review cadence and it's overdue by default).
    pool.query(
      `SELECT tp.id AS plan_id, tp.patient_id, tp.review_date, tp.start_date,
              p.first_name || ' ' || p.last_name AS patient_name
         FROM ehr_treatment_plans tp
         JOIN patients p ON p.id = tp.patient_id
        WHERE tp.practice_id = $1
          AND tp.status = 'active'
          AND (
            tp.review_date <= CURRENT_DATE
            OR (tp.review_date IS NULL AND tp.created_at < NOW() - INTERVAL '90 days')
          )
        ORDER BY tp.review_date NULLS LAST, tp.created_at ASC
        LIMIT 5`,
      [practiceId],
    ).catch(() => ({ rows: [] as any[] })),

    // 3. Unsigned progress notes drafted in the past 7 days.
    pool.query(
      `SELECT n.id AS note_id, n.patient_id, n.created_at,
              p.first_name || ' ' || p.last_name AS patient_name
         FROM ehr_progress_notes n
         LEFT JOIN patients p ON p.id = n.patient_id
        WHERE n.practice_id = $1
          AND n.status = 'draft'
          AND n.created_at > NOW() - INTERVAL '7 days'
        ORDER BY n.created_at ASC
        LIMIT 5`,
      [practiceId],
    ).catch(() => ({ rows: [] as any[] })),

    // 5. Active patients missing one or more REQUIRED consent_signatures
    //    against the latest version of each required document.
    pool.query(
      `WITH latest AS (
         SELECT DISTINCT ON (kind) id, kind, required
           FROM consent_documents
          WHERE practice_id = $1
          ORDER BY kind, effective_at DESC
       )
       SELECT p.id AS patient_id,
              p.first_name || ' ' || p.last_name AS patient_name,
              COUNT(*) AS missing_count
         FROM patients p
         CROSS JOIN latest l
         LEFT JOIN consent_signatures cs
           ON cs.document_id = l.id AND cs.patient_id = p.id
        WHERE p.practice_id = $1
          AND COALESCE(p.patient_status, 'active') NOT IN ('inactive','discharged','archived')
          AND l.required = TRUE
          AND cs.id IS NULL
        GROUP BY p.id, p.first_name, p.last_name
        ORDER BY missing_count DESC
        LIMIT 5`,
      [practiceId],
    ).catch(() => ({ rows: [] as any[] })),

    // 4. Completed appointments missing a progress note. We give a 24h
    //    grace window (don't nag the moment a session ends) but anything
    //    past that with no linked note is a billing/audit liability.
    pool.query(
      `SELECT a.id AS appointment_id, a.patient_id, a.scheduled_for,
              p.first_name || ' ' || p.last_name AS patient_name
         FROM appointments a
         LEFT JOIN patients p ON p.id = a.patient_id
        WHERE a.practice_id = $1
          AND a.status = 'completed'
          AND a.scheduled_for < NOW() - INTERVAL '1 day'
          AND a.scheduled_for > NOW() - INTERVAL '30 days'
          AND NOT EXISTS (
            SELECT 1 FROM ehr_progress_notes n
             WHERE n.appointment_id = a.id
          )
        ORDER BY a.scheduled_for ASC
        LIMIT 5`,
      [practiceId],
    ).catch(() => ({ rows: [] as any[] })),
    pool.query(
      `WITH events AS (
         SELECT id::text, patient_id, 'note_signed' AS kind,
                'Progress note signed' AS description,
                signed_at AS occurred_at
           FROM ehr_progress_notes
          WHERE practice_id = $1 AND signed_at IS NOT NULL
            AND signed_at > NOW() - INTERVAL '3 days'
         UNION ALL
         SELECT id::text, patient_id, 'mood_logged',
                'Mood logged via portal',
                logged_at
           FROM ehr_mood_logs
          WHERE practice_id = $1
            AND logged_at > NOW() - INTERVAL '3 days'
         UNION ALL
         SELECT id::text, patient_id, 'intake_completed',
                'Intake form completed',
                completed_at
           FROM intake_forms
          WHERE practice_id = $1 AND completed_at IS NOT NULL
            AND completed_at > NOW() - INTERVAL '3 days'
       )
       SELECT e.*, p.first_name || ' ' || p.last_name AS patient_name
         FROM events e
         LEFT JOIN patients p ON p.id = e.patient_id
        ORDER BY occurred_at DESC LIMIT 15`,
      [practiceId],
    ).catch(() => ({ rows: [] as any[] })),

    // 6. Wave 38 / TS5 — High suicide-risk patients (e.g. CSSRS severity ≥ 5
    //    or Q6 endorsement raised risk_level to 'high'/'crisis') who do
    //    NOT yet have a usable Stanley-Brown safety plan on file. These
    //    surface as the Today crisis card so the therapist sees them
    //    before the next session starts.
    pool.query(
      `SELECT p.id AS patient_id,
              p.first_name || ' ' || p.last_name AS patient_name,
              p.risk_level,
              (
                SELECT MAX(pa.completed_at)
                  FROM patient_assessments pa
                 WHERE pa.patient_id = p.id
                   AND pa.assessment_type = 'CSSRS'
                   AND pa.status = 'completed'
              ) AS last_cssrs_at,
              (
                SELECT MAX(pa.score)
                  FROM patient_assessments pa
                 WHERE pa.patient_id = p.id
                   AND pa.assessment_type = 'CSSRS'
                   AND pa.status = 'completed'
                   AND pa.completed_at > NOW() - INTERVAL '30 days'
              ) AS recent_cssrs_score,
              EXISTS (
                SELECT 1 FROM ehr_safety_plans sp
                 WHERE sp.patient_id = p.id
                   AND sp.status = 'active'
                   AND (
                     COALESCE(sp.section_1_warning_signs, '') <> ''
                     OR COALESCE(sp.section_2_internal_coping, '') <> ''
                     OR COALESCE(sp.section_3_distraction_contacts, '') <> ''
                     OR COALESCE(sp.section_4_help_contacts, '') <> ''
                     OR COALESCE(sp.section_5_professionals_agencies, '') <> ''
                     OR COALESCE(sp.section_6_means_restriction, '') <> ''
                   )
              ) AS has_usable_safety_plan
         FROM patients p
        WHERE p.practice_id = $1
          AND p.risk_level IN ('high','crisis')
          AND COALESCE(p.patient_status, 'active') NOT IN ('inactive','discharged','archived')
        ORDER BY p.last_contact_at DESC NULLS LAST
        LIMIT 10`,
      [practiceId],
    ).catch(() => ({ rows: [] as any[] })),
    // Wave 43 chase reminder — preauth requests waiting > 14 days for payer
    // response. Surfaces in the Needs-Attention block as a single tile.
    pool.query(
      `SELECT COUNT(*)::int AS stale_count
         FROM ehr_preauth_requests
        WHERE practice_id = $1
          AND status IN ('submitted','pending')
          AND submitted_at IS NOT NULL
          AND submitted_at < NOW() - INTERVAL '14 days'`,
      [practiceId],
    ).catch(() => ({ rows: [{ stale_count: 0 }] as any[] })),

    // Wave 41 / T5 patch — claims rejected by 277CA acknowledgment that
    // haven't been resubmitted yet. Linked to the resubmission flow on
    // the invoice detail page; if non-zero, the today screen surfaces a
    // Needs-Attention tile so the therapist sees rejections before
    // payer aging clocks them.
    pool.query(
      `SELECT COUNT(*)::int AS rejected_count
         FROM ehr_claim_submissions s
        WHERE s.practice_id = $1
          AND s.acknowledgment_status = 'rejected'
          AND NOT EXISTS (
            -- Any newer submission on the same invoice means this rejection
            -- has already been actioned (resubmitted or cancelled).
            SELECT 1 FROM ehr_claim_submissions s2
             WHERE s2.practice_id  = s.practice_id
               AND s2.invoice_id   = s.invoice_id
               AND s2.submitted_at > s.submitted_at
          )`,
      [practiceId],
    ).catch(() => ({ rows: [{ rejected_count: 0 }] as any[] })),

  ])

  const practiceName = practiceRow.rows[0]?.name || 'Your practice'

  // ── Smarter Needs-Attention (Wave 38 M3) ─────────────────────────────
  // Priority order: overdue assessments → treatment-plan reviews → unsigned
  // notes → completed appointments missing a progress note. Cap 5 visible;
  // overflow surfaces as "and N more" in the UI.
  const attentionAll: any[] = []

  function fmtMonth(d: Date): string {
    return d.toLocaleString(undefined, { month: 'short', year: 'numeric' })
  }

  // 0) Wave 38 / TS5 crisis card — high suicide-risk patients without a
  //    usable Stanley-Brown safety plan. These get top priority and are
  //    rendered with a red 'crisis' severity in the UI.
  for (const r of highRiskPatients.rows) {
    const why = r.has_usable_safety_plan
      ? r.recent_cssrs_score != null
        ? `C-SSRS severity ${r.recent_cssrs_score}/6 in last 30 days. Active safety plan on file — review before next contact.`
        : 'Risk level set to high. Active safety plan on file — review before next contact.'
      : r.recent_cssrs_score != null
        ? `C-SSRS severity ${r.recent_cssrs_score}/6 in last 30 days. No usable safety plan on file — build the Stanley-Brown plan with the patient.`
        : 'Risk level set to high. No usable safety plan on file — build the Stanley-Brown plan with the patient.'
    attentionAll.push({
      id: `crisis-${r.patient_id}`,
      kind: 'crisis_high_risk',
      patient_id: r.patient_id,
      patient_name: r.patient_name,
      label: r.patient_name || 'Unnamed patient',
      why,
      action_url: `/dashboard/patients/${r.patient_id}#safety_plan`,
      severity: 'crisis',
    })
  }

  // 1) Overdue assessments
  for (const r of overdueAssessments.rows) {
    const lastAt: Date | null = r.last_assessment_at ? new Date(r.last_assessment_at) : null
    const why = lastAt
      ? `Annual outcomes assessment overdue — last completed ${fmtMonth(lastAt)}.`
      : 'No outcomes assessment on file. Send a PHQ-9 / GAD-7 to baseline.'
    attentionAll.push({
      id: `assess-${r.patient_id}`,
      kind: 'assessment_overdue',
      patient_id: r.patient_id,
      patient_name: r.patient_name,
      label: r.patient_name || 'Unnamed patient',
      why,
      action_url: `/dashboard/patients/${r.patient_id}#assessments`,
      severity: lastAt ? 'warn' : 'info',
    })
  }

  // 2) Treatment-plan reviews due
  for (const r of treatmentPlanReviews.rows) {
    const reviewDate: Date | null = r.review_date ? new Date(r.review_date) : null
    const why = reviewDate
      ? `Treatment-plan review due ${reviewDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}.`
      : 'Treatment plan active >90 days with no review date set — schedule a review.'
    attentionAll.push({
      id: `plan-${r.plan_id}`,
      kind: 'treatment_plan_review',
      patient_id: r.patient_id,
      patient_name: r.patient_name,
      label: r.patient_name || 'Unnamed patient',
      why,
      action_url: `/dashboard/ehr/treatment-plans/${r.plan_id}`,
      severity: 'warn',
    })
  }

  // 3) Unsigned progress notes from past 7 days
  for (const r of unsignedNotes.rows) {
    const ageHours = (Date.now() - new Date(r.created_at).getTime()) / 3_600_000
    const why = ageHours > 48
      ? `Drafted ${Math.round(ageHours / 24)}d ago — sign to lock + release for billing.`
      : ageHours > 24
      ? 'Drafted yesterday. Sign to lock + release for billing.'
      : 'Drafted today. Sign when ready.'
    attentionAll.push({
      id: `note-${r.note_id}`,
      kind: 'note_unsigned',
      patient_id: r.patient_id,
      patient_name: r.patient_name,
      label: r.patient_name || 'Unnamed patient',
      why,
      action_url: `/dashboard/ehr/notes/${r.note_id}`,
      severity: ageHours > 48 ? 'warn' : 'info',
    })
  }

  // 5) Active patients missing required consents
  for (const r of missingConsents.rows) {
    attentionAll.push({
      id: `consent-${r.patient_id}`,
      kind: 'consent_expiring',
      patient_id: r.patient_id,
      patient_name: r.patient_name,
      label: r.patient_name || 'Unnamed patient',
      why: `${r.missing_count} required consent ${Number(r.missing_count) === 1 ? 'document is' : 'documents are'} unsigned. Patient portal can complete.`,
      action_url: `/dashboard/patients/${r.patient_id}#consents`,
      severity: 'warn',
    })
  }

  // 4) Completed appointments missing a progress note
  for (const r of apptsMissingNote.rows) {
    const dt = new Date(r.scheduled_for)
    const why = `Session ${dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} has no progress note. Required for billing.`
    attentionAll.push({
      id: `appt-${r.appointment_id}`,
      kind: 'appointment_missing_note',
      patient_id: r.patient_id,
      patient_name: r.patient_name,
      label: r.patient_name || 'Unnamed patient',
      why,
      action_url: `/dashboard/ehr/notes/new?patient_id=${r.patient_id}&appointment_id=${r.appointment_id}`,
      severity: 'warn',
    })
  }

  // 6) Pre-auth requests > 14 days awaiting payer response (W43 chase).
  const stalePre = Number(stalePreauthRequests.rows[0]?.stale_count ?? 0)
  if (stalePre > 0) {
    attentionAll.push({
      id: `preauth-stale-${stalePre}`,
      kind: 'preauth_response_overdue',
      patient_id: null,
      patient_name: null,
      label: `${stalePre} pre-auth request${stalePre === 1 ? '' : 's'} awaiting response`,
      why: `${stalePre === 1 ? 'A request has been' : 'Requests have been'} pending > 14 days. Chase the payer or close the loop.`,
      action_url: `/dashboard/preauth-requests`,
      severity: 'warn',
    })
  }

  // 7) Wave 41 T5 patch — claims rejected by 277CA awaiting resubmission.
  const rejected = Number(rejectedClaims.rows[0]?.rejected_count ?? 0)
  if (rejected > 0) {
    attentionAll.push({
      id: `claims-rejected-${rejected}`,
      kind: 'claim_rejected_resubmit',
      patient_id: null,
      patient_name: null,
      label: `${rejected} claim${rejected === 1 ? '' : 's'} rejected — review and resubmit`,
      why: rejected === 1
        ? 'A claim was rejected by the payer. Open the invoice to fix and resubmit.'
        : 'Claims were rejected by the payer. Open each invoice to fix and resubmit.',
      action_url: `/dashboard/billing/invoices?submission_status=rejected`,
      severity: 'warn',
    })
  }

  const attention = attentionAll.slice(0, 5)
  const attention_overflow = Math.max(0, attentionAll.length - attention.length)

  return NextResponse.json({
    practice_name: practiceName,
    greeting: `${greeting()}, ${ctx.session.email?.split('@')[0] || 'there'}`,
    appointments: appointments.rows.map(a => ({
      id: a.id,
      patient_id: a.patient_id,
      patient_first_name: a.patient_first_name,
      patient_last_name: a.patient_last_name,
      scheduled_for: a.scheduled_for,
      duration_minutes: a.duration_minutes,
      appointment_type: a.appointment_type,
      status: a.status,
      telehealth_room_slug: a.telehealth_room_slug,
      video_provider: a.video_provider,
      video_meeting_id: a.video_meeting_id,
      is_telehealth: !!a.telehealth_room_slug || a.video_provider === 'chime' || a.video_provider === 'jitsi_public' || /telehealth|video|virtual/i.test(a.appointment_type || ''),
      note_status: a.note_status,
      intake_completed: a.intake_completed,
    })),
    attention,
    activity: activity.rows.map(a => ({
      id: `${a.kind}-${a.id}`,
      kind: a.kind,
      patient_id: a.patient_id,
      patient_name: a.patient_name,
      description: a.description,
      occurred_at: a.occurred_at,
    })),
    drafts_pending: unsignedNotes.rows.length,
    crisis_count: highRiskPatients.rows.length,
    unread_messages: 0,
    attention_overflow,
  })
}
