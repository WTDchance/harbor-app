// Weekly "your week ahead" eligibility summary for therapists.
//
// Bearer CRON_SECRET. Sends one email per active practice via SES (lib/email
// is already SES-backed via Wave 5). Lists the next 7 days of scheduled
// appointments with each patient's latest insurance eligibility status.
//
// AWS canonical schema notes:
//   appointments.scheduled_for replaces scheduled_at.
//   practices.owner_email replaces notification_email.
//   patients.billing_mode column may not exist — defensive skip if missing.

import { NextResponse, type NextRequest } from 'next/server'
import { pool } from '@/lib/aws/db'
import { sendEmail, EMAIL_SUPPORT } from '@/lib/email'
import { auditSystemEvent } from '@/lib/aws/ehr/audit'
import { assertCronAuthorized } from '@/lib/cron-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const LOOKAHEAD_DAYS = 7
const PRACTICE_TZ_FALLBACK = 'America/Los_Angeles'

type EligStatus = 'active' | 'inactive' | 'error' | 'manual_pending' | 'missing_data' | 'unknown'

interface PatientRow {
  appointmentId: string
  appointmentAt: string
  patientId: string | null
  patientName: string
  eligStatus: EligStatus
  copay: number | null
  deductibleTotal: number | null
  deductibleMet: number | null
  sessionLimit: number | null
  priorAuthRequired: boolean | null
  coverageEndDate: string | null
  planName: string | null
  lastVerifiedAt: string | null
  flags: string[]
}

export async function POST(req: NextRequest) {
  const started = Date.now()
  const unauthorized = assertCronAuthorized(req)
  if (unauthorized) return unauthorized

  try {
    // AWS canonical: practices.owner_email + provisioning_state='active'.
    const { rows: practices } = await pool.query(
      `SELECT id, name, owner_email, timezone, provisioning_state
         FROM practices
        WHERE provisioning_state = 'active' AND owner_email IS NOT NULL`,
    )

    const nowIso = new Date().toISOString()
    const horizonIso = new Date(Date.now() + LOOKAHEAD_DAYS * 86_400_000).toISOString()

    let emailsSent = 0
    const errors: Array<{ practice_id: string; reason: string }> = []

    for (const practice of practices) {
      try {
        const rows = await buildRowsForPractice(practice.id, nowIso, horizonIso)
        if (rows.length === 0) continue

        const tz = practice.timezone || PRACTICE_TZ_FALLBACK
        const { subject, html } = renderWeeklyEmail({
          practiceName: practice.name || 'your practice',
          providerName: null, // AWS canonical practices doesn't carry provider_name
          tz,
          rows,
        })

        const ok = await sendEmail({
          to: practice.owner_email,
          subject,
          html,
          from: EMAIL_SUPPORT,
        })
        if (ok) emailsSent++
        else errors.push({ practice_id: practice.id, reason: 'sendEmail returned false' })
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'unknown'
        console.error(`[weekly-eligibility-email] practice ${practice.id}: ${reason}`)
        errors.push({ practice_id: practice.id, reason })
      }
    }

    auditSystemEvent({
      action: 'cron.weekly-eligibility-email.run',
      details: {
        practices_considered: practices.length,
        emails_sent: emailsSent,
        error_count: errors.length,
        duration_ms: Date.now() - started,
      },
    }).catch(() => {})

    return NextResponse.json({
      ok: true,
      practices_considered: practices.length,
      emails_sent: emailsSent,
      errors: errors.length,
      errorDetail: errors.slice(0, 10),
      durationMs: Date.now() - started,
    })
  } catch (err) {
    console.error('[weekly-eligibility-email]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'internal error' },
      { status: 500 },
    )
  }
}

async function buildRowsForPractice(
  practiceId: string,
  nowIso: string,
  horizonIso: string,
): Promise<PatientRow[]> {
  const { rows: appts } = await pool.query(
    `SELECT id, patient_id, scheduled_for
       FROM appointments
      WHERE practice_id = $1 AND status = 'scheduled'
        AND scheduled_for >= $2 AND scheduled_for <= $3
      ORDER BY scheduled_for ASC`,
    [practiceId, nowIso, horizonIso],
  )
  if (appts.length === 0) return []

  const patientIds = Array.from(new Set(appts.map(a => a.patient_id).filter(Boolean))) as string[]
  if (patientIds.length === 0) return []

  // Patients with optional billing_mode filter.
  const patientById = new Map<string, { name: string }>()
  try {
    const { rows: patients } = await pool.query(
      `SELECT id, first_name, last_name, billing_mode
         FROM patients WHERE id = ANY($1::uuid[])`,
      [patientIds],
    )
    for (const p of patients) {
      const mode = p.billing_mode || 'pending'
      if (mode === 'self_pay' || mode === 'sliding_scale') continue
      patientById.set(p.id, {
        name: [p.first_name, p.last_name].filter(Boolean).join(' ') || 'Patient',
      })
    }
  } catch {
    // billing_mode column may not exist — fall back to no-filter
    const { rows: patients } = await pool.query(
      `SELECT id, first_name, last_name FROM patients WHERE id = ANY($1::uuid[])`,
      [patientIds],
    )
    for (const p of patients) {
      patientById.set(p.id, {
        name: [p.first_name, p.last_name].filter(Boolean).join(' ') || 'Patient',
      })
    }
  }

  const { rows: insRows } = await pool.query(
    `SELECT id, patient_id, last_verified_at, last_verification_status, updated_at
       FROM insurance_records
      WHERE practice_id = $1 AND patient_id = ANY($2::uuid[])
      ORDER BY updated_at DESC`,
    [practiceId, patientIds],
  ).catch(() => ({ rows: [] as any[] }))

  const irByPatient = new Map<string, { id: string; last_verified_at: string | null }>()
  for (const r of insRows) {
    if (r.patient_id && !irByPatient.has(r.patient_id)) {
      irByPatient.set(r.patient_id, { id: r.id, last_verified_at: r.last_verified_at })
    }
  }

  const recordIds = Array.from(irByPatient.values()).map(v => v.id)
  const checkByRecord = new Map<string, any>()
  if (recordIds.length > 0) {
    const { rows: checks } = await pool.query(
      `SELECT insurance_record_id, status, is_active, copay_amount,
              deductible_total, deductible_met, session_limit,
              prior_auth_required, coverage_end_date, plan_name, checked_at
         FROM eligibility_checks
        WHERE insurance_record_id = ANY($1::uuid[])
        ORDER BY checked_at DESC`,
      [recordIds],
    ).catch(() => ({ rows: [] as any[] }))
    for (const c of checks) {
      if (!checkByRecord.has(c.insurance_record_id)) {
        checkByRecord.set(c.insurance_record_id, c)
      }
    }
  }

  const out: PatientRow[] = []
  for (const a of appts) {
    if (!a.patient_id) continue
    const patient = patientById.get(a.patient_id)
    if (!patient) continue
    const ir = irByPatient.get(a.patient_id)
    const check = ir ? checkByRecord.get(ir.id) : null

    const row: PatientRow = {
      appointmentId: a.id,
      appointmentAt: new Date(a.scheduled_for).toISOString(),
      patientId: a.patient_id,
      patientName: patient.name,
      eligStatus: (check?.status as EligStatus) || 'unknown',
      copay: check?.copay_amount ?? null,
      deductibleTotal: check?.deductible_total ?? null,
      deductibleMet: check?.deductible_met ?? null,
      sessionLimit: check?.session_limit ?? null,
      priorAuthRequired: check?.prior_auth_required ?? null,
      coverageEndDate: check?.coverage_end_date ?? null,
      planName: check?.plan_name ?? null,
      lastVerifiedAt: ir?.last_verified_at ?? null,
      flags: [],
    }
    row.flags = computeFlags(row)
    out.push(row)
  }
  return out
}

function computeFlags(r: PatientRow): string[] {
  const flags: string[] = []
  if (r.eligStatus === 'inactive') flags.push('Coverage inactive')
  if (r.eligStatus === 'error') flags.push('Verification error')
  if (r.eligStatus === 'missing_data') flags.push('Missing member ID')
  if (r.eligStatus === 'manual_pending') flags.push('Manual verification needed')
  if (r.eligStatus === 'unknown') flags.push('Never verified')
  if (r.priorAuthRequired) flags.push('Prior auth required')
  if (r.coverageEndDate) {
    const end = new Date(r.coverageEndDate)
    const days = Math.round((end.getTime() - Date.now()) / 86_400_000)
    if (days <= 30 && days >= 0) flags.push(`Coverage ends in ${days}d`)
    else if (days < 0) flags.push('Coverage already ended')
  }
  if (r.lastVerifiedAt) {
    const ageDays = (Date.now() - new Date(r.lastVerifiedAt).getTime()) / 86_400_000
    if (ageDays > 30) flags.push('Last verified >30d ago')
  }
  return flags
}

function renderWeeklyEmail(opts: {
  practiceName: string
  providerName: string | null
  tz: string
  rows: PatientRow[]
}): { subject: string; html: string } {
  const needsAttention = opts.rows.filter(r => r.flags.length > 0 || r.eligStatus !== 'active')
  const attentionCount = needsAttention.length
  const total = opts.rows.length

  const subject = attentionCount === 0
    ? `Your week ahead: ${total} appointment${total === 1 ? '' : 's'}, all verified`
    : `Your week ahead: ${total} appointment${total === 1 ? '' : 's'}, ${attentionCount} need${attentionCount === 1 ? 's' : ''} attention`

  const dayFmt = new Intl.DateTimeFormat('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', timeZone: opts.tz,
  })
  const timeFmt = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric', minute: '2-digit', timeZone: opts.tz,
  })

  const byDay = new Map<string, PatientRow[]>()
  for (const r of opts.rows) {
    const key = dayFmt.format(new Date(r.appointmentAt))
    if (!byDay.has(key)) byDay.set(key, [])
    byDay.get(key)!.push(r)
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'https://harborreceptionist.com'
  const greeting = opts.providerName ? `Hi ${opts.providerName},` : 'Hi there,'

  const dayBlocks = Array.from(byDay.entries()).map(([day, rows]) => {
    const rowsHtml = rows.map(r => renderRow(r, timeFmt)).join('')
    return `
      <div style="margin-bottom: 24px;">
        <div style="font-weight: 600; color: #0d9488; font-size: 14px; margin-bottom: 8px; border-bottom: 1px solid #e5e7eb; padding-bottom: 6px;">${escapeHtml(day)}</div>
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">${rowsHtml}</table>
      </div>`
  }).join('')

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${escapeHtml(subject)}</title></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f0; margin: 0; padding: 20px; color: #333;">
  <div style="max-width: 640px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">
    <div style="background: #0d9488; padding: 24px 32px; color: white;">
      <h1 style="margin: 0; font-size: 20px; font-weight: 600;">Your week ahead</h1>
      <div style="margin-top: 4px; font-size: 13px; opacity: 0.85;">${escapeHtml(opts.practiceName)}</div>
    </div>
    <div style="padding: 28px 32px; font-size: 15px; line-height: 1.6;">
      <p style="margin: 0 0 16px;">${escapeHtml(greeting)}</p>
      <p style="margin: 0 0 20px;">Here's your schedule for the next 7 days along with each patient's insurance status.${attentionCount > 0 ? ` <strong>${attentionCount} appointment${attentionCount === 1 ? '' : 's'} need${attentionCount === 1 ? 's' : ''} attention</strong> before the session.` : ' Everything looks verified and ready.'}</p>
      <div style="display: flex; gap: 8px; margin-bottom: 24px; flex-wrap: wrap;">
        ${summaryChip('#0d9488', `${total} total`)}
        ${summaryChip('#059669', `${total - attentionCount} verified`)}
        ${attentionCount > 0 ? summaryChip('#dc2626', `${attentionCount} need attention`) : ''}
      </div>
      ${dayBlocks}
      <div style="margin-top: 28px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
        <a href="${appUrl}/dashboard/insurance" style="display: inline-block; background: #0d9488; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">Open insurance dashboard →</a>
      </div>
    </div>
    <div style="padding: 16px 32px; background: #f9f9f7; font-size: 12px; color: #999; text-align: center;">
      Harbor — AI front office for therapists. This email summarizes eligibility status; it isn't a guarantee of payment. Verify critical cases by calling the payer.
    </div>
  </div>
</body></html>`
  return { subject, html }
}

function renderRow(r: PatientRow, timeFmt: Intl.DateTimeFormat): string {
  const time = timeFmt.format(new Date(r.appointmentAt))
  const chip = statusChip(r.eligStatus)
  const money = (n: number | null) => (n === null ? '—' : `$${n.toFixed(0)}`)
  const copay = r.eligStatus === 'active' ? money(r.copay) : '—'
  const deductible = r.eligStatus === 'active' && r.deductibleTotal !== null
    ? `${money(r.deductibleMet)} of ${money(r.deductibleTotal)}`
    : '—'
  const flagText = r.flags.length > 0
    ? `<div style="margin-top: 4px; color: #b45309; font-size: 12px;">⚠ ${r.flags.map(escapeHtml).join(' · ')}</div>`
    : ''
  return `
    <tr style="border-bottom: 1px solid #f3f4f6;">
      <td style="padding: 10px 8px 10px 0; width: 80px; color: #6b7280; vertical-align: top;">${escapeHtml(time)}</td>
      <td style="padding: 10px 8px; vertical-align: top;">
        <div style="font-weight: 600;">${escapeHtml(r.patientName)}</div>
        ${r.planName ? `<div style="color: #6b7280; font-size: 12px;">${escapeHtml(r.planName)}</div>` : ''}
        ${flagText}
      </td>
      <td style="padding: 10px 8px; vertical-align: top; white-space: nowrap;">${chip}</td>
      <td style="padding: 10px 0 10px 8px; vertical-align: top; color: #374151; font-size: 13px; white-space: nowrap;">
        <div>Copay: ${copay}</div>
        <div style="color: #6b7280; font-size: 12px;">Ded: ${deductible}</div>
      </td>
    </tr>`
}

function statusChip(status: EligStatus): string {
  const map: Record<EligStatus, { label: string; bg: string; fg: string }> = {
    active:         { label: 'Active',     bg: '#d1fae5', fg: '#065f46' },
    inactive:       { label: 'Inactive',   bg: '#fee2e2', fg: '#991b1b' },
    error:          { label: 'Error',      bg: '#fee2e2', fg: '#991b1b' },
    missing_data:   { label: 'Needs info', bg: '#fef3c7', fg: '#92400e' },
    manual_pending: { label: 'Manual',     bg: '#fef3c7', fg: '#92400e' },
    unknown:        { label: 'Unverified', bg: '#e5e7eb', fg: '#374151' },
  }
  const s = map[status] || map.unknown
  return `<span style="display: inline-block; padding: 3px 10px; border-radius: 999px; background: ${s.bg}; color: ${s.fg}; font-size: 12px; font-weight: 600;">${s.label}</span>`
}

function summaryChip(color: string, label: string): string {
  return `<span style="display: inline-block; padding: 6px 12px; border-radius: 999px; background: ${color}; color: white; font-size: 13px; font-weight: 600;">${escapeHtml(label)}</span>`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
