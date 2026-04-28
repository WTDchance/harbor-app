// app/api/ehr/patients/[id]/timeline/route.ts
//
// W46 T1 — patient timeline. Returns weighted events across the chart
// for a date range. Two-layer rendering on the client:
//   * weekly density bins (`buckets`) for the sparkline
//   * raw event list (`events`) for the expanded view
//
// Query: ?from=YYYY-MM-DD&to=YYYY-MM-DD&categories=clinical,communication,billing,admin
// Default range: last 12 months.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Category = 'clinical' | 'communication' | 'billing' | 'admin'
const ALL_CATEGORIES: Category[] = ['clinical', 'communication', 'billing', 'admin']

type TimelineEvent = {
  id: string
  occurred_at: string
  category: Category
  /** Stable identifier ('progress_note', 'assessment', 'appointment_kept', etc.). */
  kind: string
  title: string
  detail?: string | null
  /** 1..5 — informs layout density on the expanded view. 5 = full card. */
  weight: 1 | 2 | 3 | 4 | 5
  link?: string | null
}

function isoDate(s: string | null, fallback: string): string {
  if (s && /^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  return fallback
}

function weekStart(d: Date): string {
  const x = new Date(d)
  x.setUTCHours(0, 0, 0, 0)
  x.setUTCDate(x.getUTCDate() - x.getUTCDay())
  return x.toISOString().slice(0, 10)
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  // Verify patient is in this practice.
  const pCheck = await pool.query(
    `SELECT id FROM patients WHERE id = $1 AND practice_id = $2 LIMIT 1`,
    [params.id, ctx.practiceId],
  )
  if (pCheck.rows.length === 0) {
    return NextResponse.json({ error: 'patient_not_found' }, { status: 404 })
  }

  const sp = req.nextUrl.searchParams
  const today = new Date().toISOString().slice(0, 10)
  const oneYearAgo = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10)
  const from = isoDate(sp.get('from'), oneYearAgo)
  const to = isoDate(sp.get('to'), today)
  const categoriesRaw = (sp.get('categories') || '').split(',').filter(Boolean)
  const categories = categoriesRaw.length > 0
    ? (categoriesRaw.filter((c) => (ALL_CATEGORIES as string[]).includes(c)) as Category[])
    : ALL_CATEGORIES

  // ---- Pull events ---------------------------------------------------
  const events: TimelineEvent[] = []

  if (categories.includes('clinical')) {
    const apptRows = await pool.query(
      `SELECT id::text, scheduled_for::text AS occurred_at, status, appointment_type, late_canceled_at::text
         FROM appointments
        WHERE practice_id = $1 AND patient_id = $2
          AND scheduled_for::date BETWEEN $3::date AND $4::date`,
      [ctx.practiceId, params.id, from, to],
    ).catch(() => ({ rows: [] as any[] }))
    for (const r of apptRows.rows) {
      let kind = 'appointment_scheduled'
      let weight: TimelineEvent['weight'] = 3
      if (r.status === 'completed') { kind = 'appointment_kept';      weight = 4 }
      else if (r.status === 'no_show') { kind = 'appointment_no_show'; weight = 4 }
      else if (r.late_canceled_at) { kind = 'appointment_late_cancel'; weight = 3 }
      else if (r.status === 'cancelled') { kind = 'appointment_cancel'; weight = 2 }
      events.push({
        id: `appt:${r.id}`,
        occurred_at: r.occurred_at,
        category: 'clinical',
        kind,
        title: kind.replace(/_/g, ' '),
        detail: r.appointment_type ?? null,
        weight,
        link: `/dashboard/appointments/${r.id}`,
      })
    }

    const noteRows = await pool.query(
      `SELECT id::text, created_at::text AS occurred_at, title, note_format, status,
              signed_at::text
         FROM ehr_progress_notes
        WHERE practice_id = $1 AND patient_id = $2
          AND created_at::date BETWEEN $3::date AND $4::date`,
      [ctx.practiceId, params.id, from, to],
    ).catch(() => ({ rows: [] as any[] }))
    for (const r of noteRows.rows) {
      events.push({
        id: `note:${r.id}`,
        occurred_at: r.signed_at || r.occurred_at,
        category: 'clinical',
        kind: 'progress_note',
        title: r.title || 'Progress note',
        detail: `${r.note_format} · ${r.status}`,
        weight: 5,
        link: `/dashboard/ehr/notes/${r.id}`,
      })
    }

    const assessRows = await pool.query(
      `SELECT id::text, completed_at::text AS occurred_at, instrument, total_score
         FROM outcome_assessments
        WHERE practice_id = $1 AND patient_id = $2
          AND completed_at::date BETWEEN $3::date AND $4::date`,
      [ctx.practiceId, params.id, from, to],
    ).catch(() => ({ rows: [] as any[] }))
    for (const r of assessRows.rows) {
      events.push({
        id: `assess:${r.id}`,
        occurred_at: r.occurred_at,
        category: 'clinical',
        kind: 'assessment',
        title: `${r.instrument} score ${r.total_score ?? '—'}`,
        weight: 5,
        link: null,
      })
    }

    const planRows = await pool.query(
      `SELECT id::text, created_at::text AS occurred_at, title, status
         FROM ehr_treatment_plans
        WHERE practice_id = $1 AND patient_id = $2
          AND created_at::date BETWEEN $3::date AND $4::date`,
      [ctx.practiceId, params.id, from, to],
    ).catch(() => ({ rows: [] as any[] }))
    for (const r of planRows.rows) {
      events.push({
        id: `plan:${r.id}`,
        occurred_at: r.occurred_at,
        category: 'clinical',
        kind: 'treatment_plan_change',
        title: `Treatment plan: ${r.title}`,
        detail: r.status,
        weight: 5,
        link: `/dashboard/ehr/treatment-plans/${r.id}`,
      })
    }
  }

  if (categories.includes('communication')) {
    // Calls + portal messages from audit_logs (cheap, exists today).
    const callRows = await pool.query(
      `SELECT id::text, created_at::text AS occurred_at, direction, duration_seconds
         FROM call_logs
        WHERE practice_id = $1 AND patient_id = $2
          AND created_at::date BETWEEN $3::date AND $4::date`,
      [ctx.practiceId, params.id, from, to],
    ).catch(() => ({ rows: [] as any[] }))
    for (const r of callRows.rows) {
      events.push({
        id: `call:${r.id}`,
        occurred_at: r.occurred_at,
        category: 'communication',
        kind: 'phone_call',
        title: `${r.direction || 'inbound'} call`,
        detail: r.duration_seconds ? `${Math.round(r.duration_seconds / 60)}m` : null,
        weight: 2,
      })
    }
  }

  if (categories.includes('billing')) {
    const chargeRows = await pool.query(
      `SELECT id::text, service_date::text AS occurred_at, cpt_code, fee_cents, status
         FROM ehr_charges
        WHERE practice_id = $1 AND patient_id = $2
          AND service_date BETWEEN $3::date AND $4::date`,
      [ctx.practiceId, params.id, from, to],
    ).catch(() => ({ rows: [] as any[] }))
    for (const r of chargeRows.rows) {
      events.push({
        id: `charge:${r.id}`,
        occurred_at: r.occurred_at,
        category: 'billing',
        kind: 'charge',
        title: `Charge ${r.cpt_code}`,
        detail: `$${(Number(r.fee_cents) / 100).toFixed(2)} · ${r.status}`,
        weight: 2,
      })
    }
    const payRows = await pool.query(
      `SELECT id::text, received_at::text AS occurred_at, source, amount_cents
         FROM ehr_payments
        WHERE practice_id = $1 AND patient_id = $2
          AND received_at::date BETWEEN $3::date AND $4::date`,
      [ctx.practiceId, params.id, from, to],
    ).catch(() => ({ rows: [] as any[] }))
    for (const r of payRows.rows) {
      events.push({
        id: `pay:${r.id}`,
        occurred_at: r.occurred_at,
        category: 'billing',
        kind: 'payment',
        title: `Payment ${r.source}`,
        detail: `$${(Number(r.amount_cents) / 100).toFixed(2)}`,
        weight: 2,
      })
    }
  }

  if (categories.includes('admin')) {
    // Generic chart access events from audit_logs — keep small.
    const adminRows = await pool.query(
      `SELECT id::text, timestamp::text AS occurred_at, action
         FROM audit_logs
        WHERE practice_id = $1
          AND resource_type IN ('patient', 'appointment')
          AND resource_id::text = $2
          AND timestamp::date BETWEEN $3::date AND $4::date
        ORDER BY timestamp DESC
        LIMIT 50`,
      [ctx.practiceId, params.id, from, to],
    ).catch(() => ({ rows: [] as any[] }))
    for (const r of adminRows.rows) {
      events.push({
        id: `admin:${r.id}`,
        occurred_at: r.occurred_at,
        category: 'admin',
        kind: r.action,
        title: r.action.replace(/[._]/g, ' '),
        weight: 1,
      })
    }
  }

  // Sort newest first.
  events.sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))

  // Build weekly buckets keyed by week_start for the sparkline.
  const bucketMap = new Map<string, Record<Category, number>>()
  for (const e of events) {
    const ws = weekStart(new Date(e.occurred_at))
    const cur = bucketMap.get(ws) || { clinical: 0, communication: 0, billing: 0, admin: 0 }
    cur[e.category] += 1
    bucketMap.set(ws, cur)
  }
  const buckets = Array.from(bucketMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week_start, counts]) => ({ week_start, ...counts }))

  await auditEhrAccess({
    ctx,
    action: 'patient_timeline.viewed',
    resourceType: 'patient',
    resourceId: params.id,
    details: {
      event_count: events.length,
      categories: categories.join(','),
      range_days: Math.max(1, Math.round(
        (new Date(to).getTime() - new Date(from).getTime()) / 86_400_000,
      )),
    },
  })

  return NextResponse.json({
    from,
    to,
    categories,
    buckets,
    events,
  })
}
