// app/api/cron/ehr-era-poll/route.ts
// Poll Stedi for 835 ERA files and reconcile against our submitted claims.
// Called by cron-job.org every ~15 minutes with Bearer CRON_SECRET.
//
// Strategy:
//   1. List recent ERA documents from Stedi
//   2. For each ERA, parse claim payment details
//   3. Match by control_number to ehr_claims rows
//   4. Insert ehr_payments, update ehr_claims.status + ehr_charges.status
//
// Stedi's ERA fetch endpoint returns normalized JSON (we don't parse
// raw X12). When we don't have real ERA data (sandbox mode, or Stedi
// returns nothing), this route just returns {checked:0}.

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

// Stedi returns ERA files at this endpoint once available.
// Reference: https://www.stedi.com/docs/healthcare/era
const STEDI_ERA_URL =
  'https://healthcare.us.stedi.com/2024-04-01/change/medicalnetwork/era'

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') || ''
  const expected = `Bearer ${process.env.CRON_SECRET || ''}`
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const apiKey = process.env.STEDI_API_KEY
  if (!apiKey) {
    return NextResponse.json({ checked: 0, reason: 'STEDI_API_KEY not configured' })
  }

  let eras: any[] = []
  try {
    const resp = await fetch(STEDI_ERA_URL, {
      method: 'GET',
      headers: { Authorization: `Key ${apiKey}` },
    })
    if (resp.ok) {
      const j = await resp.json()
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
      const controlNumber = ci.patientControlNumber || ci.claimControlNumber || ci.controlNumber
      if (!controlNumber) { unmatched++; continue }

      const { data: claim } = await supabaseAdmin
        .from('ehr_claims').select('id, practice_id, charge_id').eq('control_number', controlNumber).maybeSingle()
      if (!claim) { unmatched++; continue }

      const paidCents = Math.round(Number(ci.totalPaidAmount || ci.paidAmount || 0) * 100)
      const status = paidCents > 0 ? 'paid' : (ci.claimStatusCode === '4' ? 'denied' : 'paid')

      // Write a payment row linked to the charge
      await supabaseAdmin.from('ehr_payments').insert({
        practice_id: claim.practice_id,
        charge_id: claim.charge_id,
        source: 'insurance_era',
        amount_cents: paidCents,
        era_json: ci,
        note: `ERA payment · control #${controlNumber}`,
      })

      // Advance claim + charge status
      await supabaseAdmin.from('ehr_claims').update({
        status, stedi_response_json: era,
      }).eq('id', claim.id)

      // Charge status — paid if fully covered, denied if zero
      const { data: charge } = await supabaseAdmin
        .from('ehr_charges').select('allowed_cents').eq('id', claim.charge_id).maybeSingle()
      const fullyPaid = charge && paidCents >= Number(charge.allowed_cents)
      await supabaseAdmin.from('ehr_charges')
        .update({ status: paidCents === 0 ? 'denied' : fullyPaid ? 'paid' : 'partial' })
        .eq('id', claim.charge_id)

      matched++
    }
  }

  return NextResponse.json({ checked: eras.length, matched, unmatched })
}
