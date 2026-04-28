// app/api/ehr/reengagement/candidates/route.ts
//
// W43 T4 — return lapsed patients eligible for re-engagement outreach
// for a given campaign.
//
// "Lapsed" = no completed appointment in the last `inactive_days` AND
// no upcoming scheduled appointment AND not already discharged. Patients
// who already received outreach for this campaign in the last 30 days
// are also excluded so we don't spam.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const campaignId = req.nextUrl.searchParams.get('campaign_id')
  if (!campaignId) {
    return NextResponse.json({ error: 'campaign_id required' }, { status: 400 })
  }

  const cRes = await pool.query(
    `SELECT id, inactive_days, channel
       FROM ehr_reengagement_campaigns
      WHERE id = $1 AND practice_id = $2 AND active = TRUE
      LIMIT 1`,
    [campaignId, ctx.practiceId],
  )
  const campaign = cRes.rows[0]
  if (!campaign) {
    return NextResponse.json({ error: 'campaign_not_found_or_inactive' }, { status: 404 })
  }

  // Find candidates. A patient is a candidate when:
  //   * has at least one completed appointment ever (so we know they're a
  //     real patient, not a tire-kicker inquiry)
  //   * the most recent completed appointment is older than inactive_days
  //   * has no scheduled or confirmed appointment in the future
  //   * is not currently discharged
  //   * was not already outreached via this campaign in the last 30 days
  const { rows } = await pool.query(
    `WITH most_recent AS (
       SELECT patient_id, MAX(scheduled_for) AS last_completed
         FROM appointments
        WHERE practice_id = $1
          AND status = 'completed'
        GROUP BY patient_id
     ),
     upcoming AS (
       SELECT DISTINCT patient_id FROM appointments
        WHERE practice_id = $1
          AND status IN ('scheduled', 'confirmed')
          AND scheduled_for > NOW()
     ),
     recent_outreach AS (
       SELECT DISTINCT patient_id FROM ehr_reengagement_outreach
        WHERE practice_id = $1
          AND campaign_id = $2
          AND created_at > NOW() - INTERVAL '30 days'
     )
     SELECT p.id, p.first_name, p.last_name, p.email, p.phone,
            p.communication_preference,
            mr.last_completed,
            EXTRACT(EPOCH FROM (NOW() - mr.last_completed))::bigint / 86400 AS days_since_last
       FROM patients p
       JOIN most_recent mr ON mr.patient_id = p.id
      WHERE p.practice_id = $1
        AND COALESCE(p.patient_status, 'active') <> 'discharged'
        AND mr.last_completed < NOW() - ($3::int * INTERVAL '1 day')
        AND p.id NOT IN (SELECT patient_id FROM upcoming)
        AND p.id NOT IN (SELECT patient_id FROM recent_outreach)
      ORDER BY mr.last_completed ASC
      LIMIT 200`,
    [ctx.practiceId, campaignId, campaign.inactive_days],
  )

  await auditEhrAccess({
    ctx,
    action: 'reengagement.patient_flagged',
    resourceType: 'ehr_reengagement_campaign',
    resourceId: campaignId,
    details: { candidate_count: rows.length, inactive_days: campaign.inactive_days },
  })

  return NextResponse.json({ candidates: rows, campaign })
}
