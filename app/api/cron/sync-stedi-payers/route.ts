import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { assertCronAuthorized } from '@/lib/cron-auth'

const STEDI_PAYERS_URL = 'https://healthcare.us.stedi.com/2024-04-01/payers'

/**
 * GET /api/cron/sync-stedi-payers
 *
 * Pulls the full Stedi payer directory (~3600 payers) and upserts into
 * the stedi_payers table. Run weekly via cron-job.org to pick up new
 * payers or changed eligibility support. Safe to re-run — idempotent upsert.
 */
export async function GET(req: NextRequest) {
  const authErr = assertCronAuthorized(req)
  if (authErr) return authErr

  const stediApiKey = process.env.STEDI_API_KEY
  if (!stediApiKey) {
    return NextResponse.json({ error: 'STEDI_API_KEY not configured' }, { status: 500 })
  }

  try {
    const start = Date.now()
    const allPayers: any[] = []
    let nextPageToken: string | null = null
    let page = 0

    // Paginate through Stedi payer list
    while (page < 100) {
      const url = `${STEDI_PAYERS_URL}?pageSize=100${nextPageToken ? `&pageToken=${nextPageToken}` : ''}`
      const res = await fetch(url, {
        headers: { 'Authorization': `Key ${stediApiKey}` },
      })

      if (!res.ok) {
        const body = await res.text().catch(() => '')
        return NextResponse.json({
          error: `Stedi API returned ${res.status} on page ${page}`,
          detail: body.slice(0, 200),
        }, { status: 502 })
      }

      const data = await res.json()
      const items: any[] = data.items ?? []
      allPayers.push(...items)
      nextPageToken = data.nextPageToken ?? null
      page++
      if (!nextPageToken || items.length === 0) break
    }

    // Batch upsert into stedi_payers
    let upserted = 0
    let eligCount = 0
    const errors: string[] = []
    const BATCH = 200

    for (let i = 0; i < allPayers.length; i += BATCH) {
      const batch = allPayers.slice(i, i + BATCH)
      const rows = batch.map((p: any) => {
        const ts = p.transactionSupport ?? {}
        const elig = ts.eligibilityCheck === 'SUPPORTED'
        const claim = ts.claimSubmission === 'SUPPORTED' ||
          ts.professionalClaimSubmission === 'SUPPORTED' ||
          ts.institutionalClaimSubmission === 'SUPPORTED'
        if (elig) eligCount++
        return {
          stedi_id: p.stediId,
          display_name: p.displayName,
          primary_payer_id: p.primaryPayerId ?? null,
          aliases: p.aliases ?? [],
          names: p.names ?? [],
          eligibility_supported: elig,
          claim_submission_supported: claim,
          claim_status_supported: ts.claimStatus === 'SUPPORTED',
          operating_states: p.operatingStates ?? [],
          raw_transaction_support: ts,
          avatar_url: p.avatarUrl ?? null,
          website_url: p.urls?.website ?? null,
          synced_at: new Date().toISOString(),
        }
      })

      const { error } = await supabaseAdmin
        .from('stedi_payers')
        .upsert(rows, { onConflict: 'stedi_id' })
      if (error) errors.push(`Batch ${Math.floor(i / BATCH)}: ${error.message}`)
      else upserted += rows.length
    }

    return NextResponse.json({
      ok: errors.length === 0,
      totalFetched: allPayers.length,
      upserted,
      eligibilitySupported: eligCount,
      errors,
      durationMs: Date.now() - start,
    })
  } catch (err) {
    console.error('[sync-stedi-payers] unexpected error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Sync failed' },
      { status: 500 }
    )
  }
}
