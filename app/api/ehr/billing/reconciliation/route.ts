// app/api/ehr/billing/reconciliation/route.ts
//
// W44 T2 — practice billing reconciliation report.
//
// Read-only summary of revenue cycle health for a date range. Joins
// ehr_charges (the source of truth for "what was billed") with
// ehr_era_claim_payments (W41 T4 — what payers actually paid /
// adjusted off / denied) and ehr_payments (patient-paid). No schema
// changes.
//
// Query params:
//   from=YYYY-MM-DD          default = first of current month
//   to=YYYY-MM-DD            default = today
//   format=json|csv          default = json. csv exports the per-payer
//                            breakdown for a spreadsheet.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function isoDate(s: string | null, fallback: string): string {
  if (s && /^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  return fallback
}

function csvEscape(v: unknown): string {
  if (v == null) return ''
  const s = String(v)
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

export async function GET(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const now = new Date()
  const firstOfMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`
  const today = now.toISOString().slice(0, 10)

  const sp = req.nextUrl.searchParams
  const from = isoDate(sp.get('from'), firstOfMonth)
  const to = isoDate(sp.get('to'), today)
  const format = sp.get('format') === 'csv' ? 'csv' : 'json'

  // ---- 1) Total billed by therapist + by payer ------------------------
  const billedByTherapist = await pool.query(
    `SELECT
       c.note_id,
       n.therapist_id::text                                  AS therapist_id,
       COALESCE(t.first_name || ' ' || t.last_name, '— Unassigned') AS therapist_name,
       SUM(c.fee_cents)::bigint                              AS billed_cents,
       COUNT(*)::int                                         AS charge_count
     FROM ehr_charges c
     LEFT JOIN ehr_progress_notes n ON n.id = c.note_id
     LEFT JOIN therapists t ON t.id = n.therapist_id
     WHERE c.practice_id = $1
       AND c.service_date >= $2::date AND c.service_date <= $3::date
     GROUP BY c.note_id, n.therapist_id, t.first_name, t.last_name`,
    [ctx.practiceId, from, to],
  )

  // Roll up the by-therapist data (we group by note_id to keep the
  // query fast; collapse here in JS instead of a window).
  const therapistMap = new Map<string, { therapist_id: string | null; therapist_name: string; billed_cents: number; charge_count: number }>()
  for (const r of billedByTherapist.rows) {
    const key = String(r.therapist_id || 'unassigned')
    const existing = therapistMap.get(key)
    if (existing) {
      existing.billed_cents += Number(r.billed_cents)
      existing.charge_count += Number(r.charge_count)
    } else {
      therapistMap.set(key, {
        therapist_id: r.therapist_id || null,
        therapist_name: r.therapist_name || '— Unassigned',
        billed_cents: Number(r.billed_cents),
        charge_count: Number(r.charge_count),
      })
    }
  }
  const billedByTherapistRows = Array.from(therapistMap.values())
    .sort((a, b) => b.billed_cents - a.billed_cents)

  // ---- 2) Per-payer rollup --------------------------------------------
  // Pulled from ehr_era_claim_payments joined to the parent file for
  // payer name. Counts paid/adjusted/denied amounts and days-in-AR
  // (median time between submitted_at on the claim and the era file's
  // payment_date).
  const payerRollup = await pool.query(
    `SELECT
       COALESCE(f.payer_name, 'Unknown payer')              AS payer_name,
       SUM(p.charge_amount_cents)::bigint                   AS billed_cents,
       SUM(p.paid_amount_cents)::bigint                     AS paid_cents,
       SUM(GREATEST(p.charge_amount_cents - p.paid_amount_cents - p.patient_responsibility_cents, 0))::bigint
                                                            AS adjusted_off_cents,
       COUNT(*) FILTER (WHERE p.claim_status_code = '4')::int AS denied_count,
       SUM(p.charge_amount_cents) FILTER (WHERE p.claim_status_code = '4')::bigint
                                                            AS denied_cents,
       COUNT(*)::int                                        AS line_count,
       AVG(EXTRACT(EPOCH FROM (f.payment_date::timestamptz - inv.created_at)) / 86400)
         FILTER (WHERE f.payment_date IS NOT NULL AND inv.created_at IS NOT NULL)
                                                            AS avg_days_in_ar
     FROM ehr_era_claim_payments p
     JOIN ehr_era_files f ON f.id = p.era_file_id
     LEFT JOIN ehr_invoices inv ON inv.id = p.matched_invoice_id
     WHERE p.practice_id = $1
       AND f.payment_date >= $2::date AND f.payment_date <= $3::date
     GROUP BY COALESCE(f.payer_name, 'Unknown payer')
     ORDER BY billed_cents DESC NULLS LAST`,
    [ctx.practiceId, from, to],
  )

  // ---- 3) Outstanding receivables (submitted but not adjudicated) -----
  const outstanding = await pool.query(
    `SELECT COALESCE(SUM(c.fee_cents), 0)::bigint AS outstanding_cents,
            COUNT(*)::int                          AS outstanding_count
       FROM ehr_charges c
      WHERE c.practice_id = $1
        AND c.status IN ('submitted', 'partial')
        AND c.service_date >= $2::date AND c.service_date <= $3::date`,
    [ctx.practiceId, from, to],
  )

  // ---- 4) Top 10 denial reasons ---------------------------------------
  // adjustments_json is an array of objects with { group, code, amount }
  // per CARC/RARC. We extract code+description and count per code.
  const denialReasons = await pool.query(
    `SELECT
       reason->>'code'  AS code,
       reason->>'reason' AS reason_text,
       COUNT(*)::int    AS count,
       SUM((reason->>'amount')::bigint)::bigint AS total_cents
     FROM ehr_era_claim_payments p
     JOIN ehr_era_files f ON f.id = p.era_file_id
     CROSS JOIN LATERAL jsonb_array_elements(COALESCE(p.adjustments_json, '[]'::jsonb)) AS reason
     WHERE p.practice_id = $1
       AND f.payment_date >= $2::date AND f.payment_date <= $3::date
       AND reason->>'code' IS NOT NULL
     GROUP BY reason->>'code', reason->>'reason'
     ORDER BY total_cents DESC NULLS LAST
     LIMIT 10`,
    [ctx.practiceId, from, to],
  )

  // ---- 5) Patient-paid total (from ehr_payments) ----------------------
  const patientPaid = await pool.query(
    `SELECT COALESCE(SUM(amount_cents), 0)::bigint AS patient_paid_cents
       FROM ehr_payments
      WHERE practice_id = $1
        AND received_at::date >= $2::date AND received_at::date <= $3::date
        AND source IN ('patient_stripe', 'manual_check', 'manual_cash', 'manual_card_external')`,
    [ctx.practiceId, from, to],
  )

  const totals = {
    total_billed_cents:  billedByTherapistRows.reduce((s, r) => s + r.billed_cents, 0),
    total_insurance_paid_cents: payerRollup.rows.reduce((s: number, r: any) => s + Number(r.paid_cents || 0), 0),
    total_patient_paid_cents:   Number(patientPaid.rows[0]?.patient_paid_cents || 0),
    total_adjusted_off_cents:   payerRollup.rows.reduce((s: number, r: any) => s + Number(r.adjusted_off_cents || 0), 0),
    total_denied_cents:         payerRollup.rows.reduce((s: number, r: any) => s + Number(r.denied_cents || 0), 0),
    outstanding_cents:          Number(outstanding.rows[0]?.outstanding_cents || 0),
    outstanding_count:          Number(outstanding.rows[0]?.outstanding_count || 0),
  }

  if (format === 'csv') {
    // Per-payer breakdown CSV.
    const lines: string[] = [
      'payer_name,billed_cents,paid_cents,adjusted_off_cents,denied_count,denied_cents,line_count,avg_days_in_ar',
    ]
    for (const r of payerRollup.rows) {
      lines.push([
        r.payer_name,
        r.billed_cents || 0,
        r.paid_cents || 0,
        r.adjusted_off_cents || 0,
        r.denied_count || 0,
        r.denied_cents || 0,
        r.line_count || 0,
        r.avg_days_in_ar != null ? Number(r.avg_days_in_ar).toFixed(1) : '',
      ].map(csvEscape).join(','))
    }
    const csv = lines.join('\n')

    await auditEhrAccess({
      ctx,
      action: 'billing_reconciliation.exported',
      resourceType: 'billing_reconciliation',
      details: {
        payer_count: payerRollup.rows.length,
        therapist_count: billedByTherapistRows.length,
      },
    })

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="reconciliation-${from}-to-${to}.csv"`,
        'Cache-Control': 'no-store',
      },
    })
  }

  await auditEhrAccess({
    ctx,
    action: 'billing_reconciliation.viewed',
    resourceType: 'billing_reconciliation',
    details: {
      payer_count: payerRollup.rows.length,
      therapist_count: billedByTherapistRows.length,
      range_days: Math.max(1, Math.round(
        (new Date(to).getTime() - new Date(from).getTime()) / 86_400_000,
      )),
    },
  })

  return NextResponse.json({
    from,
    to,
    totals,
    by_therapist: billedByTherapistRows,
    by_payer: payerRollup.rows,
    top_denial_reasons: denialReasons.rows,
  })
}
