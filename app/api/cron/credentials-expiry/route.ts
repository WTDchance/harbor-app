// app/api/cron/credentials-expiry/route.ts
//
// W49 D3 — daily sweep for licenses whose expiration crossed a 60/30/7
// day threshold since the previous run. Audit-logs at warning severity
// and (best-effort) emails the practice owner.

import { NextResponse, type NextRequest } from 'next/server'
import { pool } from '@/lib/aws/db'
import { auditSystemEvent } from '@/lib/aws/ehr/audit'
import { assertCronAuthorized } from '@/lib/cron-auth'
import { sendEmail } from '@/lib/email'
import { EXPIRY_THRESHOLDS, daysUntil, pickThresholdToFire } from '@/lib/ehr/credentialing'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const unauth = assertCronAuthorized(req)
  if (unauth) return unauth

  // Only consider licenses set to active and with an expires_at within
  // the largest threshold (60d) plus a small buffer for "just expired".
  const horizonDays = EXPIRY_THRESHOLDS[0] + 1
  const { rows: licenses } = await pool.query<{
    id: string
    practice_id: string
    therapist_id: string
    type: string
    state: string
    license_number: string
    expires_at: string
    last_warning_threshold: number | null
    therapist_name: string
    practice_name: string
    owner_email: string
  }>(
    `SELECT l.id, l.practice_id, l.therapist_id, l.type, l.state,
            l.license_number, l.expires_at, l.last_warning_threshold,
            t.display_name AS therapist_name,
            pr.name AS practice_name,
            pr.owner_email AS owner_email
       FROM therapist_licenses l
       JOIN therapists t  ON t.id = l.therapist_id
       JOIN practices pr  ON pr.id = l.practice_id
      WHERE l.status = 'active'
        AND l.expires_at IS NOT NULL
        AND l.expires_at <= (CURRENT_DATE + ($1 || ' days')::interval)`,
    [String(horizonDays)],
  )

  let warningsFired = 0
  let expired = 0
  for (const row of licenses) {
    const days = daysUntil(row.expires_at)
    if (days === null) continue

    // Already expired — flip status, audit critical, do not re-send.
    if (days < 0) {
      const upd = await pool.query(
        `UPDATE therapist_licenses
            SET status = 'expired'
          WHERE id = $1 AND status = 'active'
          RETURNING id`,
        [row.id],
      )
      if (upd.rows.length > 0) {
        expired += 1
        await auditSystemEvent({
          action: 'credential.license.expired',
          practiceId: row.practice_id,
          resourceType: 'therapist_license',
          resourceId: row.id,
          severity: 'critical',
          details: {
            therapist_id: row.therapist_id,
            therapist_name: row.therapist_name,
            type: row.type, state: row.state,
            expires_at: row.expires_at,
          },
        })
      }
      continue
    }

    const t = pickThresholdToFire(row.last_warning_threshold, days)
    if (t == null) continue

    await pool.query(
      `UPDATE therapist_licenses SET last_warning_threshold = $1 WHERE id = $2`,
      [t, row.id],
    )
    warningsFired += 1

    await auditSystemEvent({
      action: 'credential.license.expiry_warning',
      practiceId: row.practice_id,
      resourceType: 'therapist_license',
      resourceId: row.id,
      severity: t <= 7 ? 'critical' : 'warning',
      details: {
        therapist_id: row.therapist_id,
        therapist_name: row.therapist_name,
        type: row.type,
        state: row.state,
        expires_at: row.expires_at,
        days_left: days,
        threshold: t,
      },
    })

    if (row.owner_email) {
      sendEmail({
        to: row.owner_email,
        subject: `License expiring in ${days} days — ${row.therapist_name} (${row.type}, ${row.state})`,
        html:
          `<p>Heads up — <strong>${row.therapist_name}</strong>'s ${row.type} license in ${row.state} ` +
          `(#${row.license_number}) expires on <strong>${row.expires_at}</strong> ` +
          `(${days} day${days === 1 ? '' : 's'} from now).</p>` +
          `<p><a href="${process.env.NEXT_PUBLIC_APP_URL ?? ''}/dashboard/settings/therapists/${row.therapist_id}/credentials">Renew or update the license →</a></p>`,
      }).catch((err: any) => {
        console.error('[credentials-expiry] email failed', err?.message ?? err)
      })
    }
  }

  await auditSystemEvent({
    action: 'credential.expiry_cron_run',
    severity: 'info',
    details: {
      licenses_scanned: licenses.length,
      warnings_fired: warningsFired,
      newly_expired: expired,
    },
  })

  return NextResponse.json({ ok: true, scanned: licenses.length, warnings: warningsFired, expired })
}
