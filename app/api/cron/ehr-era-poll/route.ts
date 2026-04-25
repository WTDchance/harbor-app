// Cron — Stedi ERA polling + claim reconciliation.
// Runs every ~15 min via cron-job.org. Bearer ${CRON_SECRET} auth.
//
// Flow:
//   1. List recent 835 ERA documents from Stedi.
//   2. For each ERA → for each claim row inside, match by control_number
//      to ehr_claims.
//   3. Insert ehr_payments, update ehr_claims + ehr_charges status.
//   4. Audit-log the tick so it shows up in audit-export / CloudWatch.

import { NextResponse, type NextRequest } from 'next/server'
import { pool } from '@/lib/aws/db'
import { auditSystemEvent } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const STEDI_ERA_URL =
  'https://healthcare.us.stedi.com/2024-04-01/change/medicalnetwork/era'

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') || ''
  const expected = `Bearer ${process.env.CRON_SECRET || ''}`
  if (!process.env.CRON_SECRET || auth !== expected) return unauthorized()

  const apiKey = process.env.STEDI_API_KEY
  if (!apiKey) {
    auditSystemEvent({
      action: 'cron.ehr-era-poll.skipped',
      details: { reason: 'STEDI_API_KEY not configured' },
    }).catch(() => {})
    return NextResponse.json({ checked: 0, reason: 'STEDI_API_KEY not configured' })
  }

  let eras: any[] = []
  try {
    const resp = await fetch(STEDI_ERA_URL, {
      method: 'GET',
      headers: { Authorization: `Key ${apiKey}` },
    })
    if (resp.ok) {
      const j = await resp.json() as { eras?: any[]; items?: any[] }
      eras = Array.isArray(j?.eras) ? j.eras : Array.isArray(j?.items) ? j.items : []
    }
  } catch (err) {
    console.error('[cron/era-poll] Stedi fetch failed', err)
  }

  let matched = 0
  let unmatched = 0

  for (const era of eras) {
    const claimInfos: any[] = era.claimInformations || era.claims || []
    for (const ci of claimInfos) {
      const controlNumber =
        ci.patientControlNumber || ci.claimControlNumber || ci.controlNumber
      if (!controlNumber) { unmatched++; continue }

      const claimResult = await pool.query(
        `SELECT id, practice_id, charge_id FROM ehr_claims
          WHERE control_number = $1 LIMIT 1`,
        [controlNumber],
      ).catch(() => ({ rows: [] as any[] }))
      const claim = claimResult.rows[0]
      if (!claim) { unmatched++; continue }

      const paidCents = Math.round(Number(ci.totalPaidAmount || ci.paidAmount || 0) * 100)
      const status = paidCents > 0
        ? 'paid'
        : (ci.claimStatusCode === '4' ? 'denied' : 'paid')

      // Insert payment row.
      await pool.query(
        `INSERT INTO ehr_payments (
           practice_id, charge_id, source, amount_cents, era_json, note
         ) VALUES ($1, $2, 'insurance_era', $3, $4::jsonb, $5)`,
        [claim.practice_id, claim.charge_id, paidCents, JSON.stringify(ci),
         `ERA payment · control #${controlNumber}`],
      ).catch(err => console.error('[cron/era-poll] payment insert failed', err))

      // Advance claim status.
      await pool.query(
        `UPDATE ehr_claims
            SET status = $1, stedi_response_json = $2::jsonb, updated_at = NOW()
          WHERE id = $3`,
        [status, JSON.stringify(era), claim.id],
      ).catch(err => console.error('[cron/era-poll] claim update failed', err))

      // Advance charge status.
      const chargeResult = await pool.query(
        `SELECT allowed_cents FROM ehr_charges WHERE id = $1 LIMIT 1`,
        [claim.charge_id],
      ).catch(() => ({ rows: [] as any[] }))
      const charge = chargeResult.rows[0]
      const fullyPaid = charge && paidCents >= Number(charge.allowed_cents)
      const chargeStatus = paidCents === 0 ? 'denied' : fullyPaid ? 'paid' : 'partial'
      await pool.query(
        `UPDATE ehr_charges SET status = $1, updated_at = NOW() WHERE id = $2`,
        [chargeStatus, claim.charge_id],
      ).catch(err => console.error('[cron/era-poll] charge update failed', err))

      matched++
    }
  }

  auditSystemEvent({
    action: 'cron.ehr-era-poll.run',
    details: { eras_checked: eras.length, matched, unmatched },
  }).catch(() => {})

  return NextResponse.json({ checked: eras.length, matched, unmatched })
}
