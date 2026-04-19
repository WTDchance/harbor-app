/**
 * Fetches the full Stedi payer directory and upserts it into stedi_payers.
 *
 * Called by /api/cron/sync-stedi-payers on a weekly cadence and once manually
 * at launch to seed the table. Handles pagination (100 per page, ~37 pages).
 */

import type { SupabaseClient } from '@supabase/supabase-js'

const STEDI_PAYERS_URL = 'https://healthcare.us.stedi.com/2024-04-01/payers'
const PAGE_SIZE = 100

interface StediPayer {
  stediId: string
  displayName: string
  primaryPayerId?: string
  aliases?: string[]
  names?: string[]
  transactionSupport?: {
    eligibilityCheck?: string
    claimSubmission?: string
    professionalClaimSubmission?: string
    institutionalClaimSubmission?: string
    claimStatus?: string
    [key: string]: string | undefined
  }
  operatingStates?: string[]
  avatarUrl?: string
  urls?: { website?: string }
}

interface SyncResult {
  totalFetched: number
  upserted: number
  eligibilitySupported: number
  errors: string[]
  durationMs: number
}

export async function syncStediPayers(
  supabase: SupabaseClient
): Promise<SyncResult> {
  const start = Date.now()
  const stediApiKey = process.env.STEDI_API_KEY
  if (!stediApiKey) {
    return {
      totalFetched: 0, upserted: 0, eligibilitySupported: 0,
      errors: ['STEDI_API_KEY not configured'],
      durationMs: Date.now() - start,
    }
  }

  const allPayers: StediPayer[] = []
  let nextPageToken: string | null = null
  let page = 0

  // ---- paginate through Stedi's payer list ----
  while (page < 100) { // safety cap
    const url = new URL(STEDI_PAYERS_URL)
    url.searchParams.set('pageSize', String(PAGE_SIZE))
    if (nextPageToken) url.searchParams.set('pageToken', nextPageToken)

    const res = await fetch(url.toString(), {
      headers: { 'Authorization': `Key ${stediApiKey}` },
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return {
        totalFetched: allPayers.length, upserted: 0, eligibilitySupported: 0,
        errors: [`Stedi API returned ${res.status} on page ${page}: ${body.slice(0, 200)}`],
        durationMs: Date.now() - start,
      }
    }

    const data = await res.json()
    const items: StediPayer[] = data.items ?? []
    allPayers.push(...items)
    nextPageToken = data.nextPageToken ?? null
    page++

    if (!nextPageToken || items.length === 0) break
  }

  // ---- transform and batch upsert ----
  const errors: string[] = []
  let upserted = 0
  let eligCount = 0
  const BATCH_SIZE = 200
  const nowIso = new Date().toISOString()

  for (let i = 0; i < allPayers.length; i += BATCH_SIZE) {
    const batch = allPayers.slice(i, i + BATCH_SIZE)
    const rows = batch.map((p) => {
      const ts = p.transactionSupport ?? {}
      const eligSupported = ts.eligibilityCheck === 'SUPPORTED'
      const claimSupported =
        ts.claimSubmission === 'SUPPORTED' ||
        ts.professionalClaimSubmission === 'SUPPORTED' ||
        ts.institutionalClaimSubmission === 'SUPPORTED'
      const statusSupported = ts.claimStatus === 'SUPPORTED'

      if (eligSupported) eligCount++

      return {
        stedi_id: p.stediId,
        display_name: p.displayName,
        primary_payer_id: p.primaryPayerId ?? null,
        aliases: JSON.stringify(p.aliases ?? []),
        names: JSON.stringify(p.names ?? []),
        eligibility_supported: eligSupported,
        claim_submission_supported: claimSupported,
        claim_status_supported: statusSupported,
        operating_states: p.operatingStates ?? [],
        raw_transaction_support: ts,
        avatar_url: p.avatarUrl ?? null,
        website_url: p.urls?.website ?? null,
        synced_at: nowIso,
      }
    })

    const { error } = await supabase
      .from('stedi_payers')
      .upsert(rows, { onConflict: 'stedi_id' })

    if (error) {
      errors.push(`Batch ${i / BATCH_SIZE}: ${error.message}`)
    } else {
      upserted += rows.length
    }
  }

  return {
    totalFetched: allPayers.length,
    upserted,
    eligibilitySupported: eligCount,
    errors,
    durationMs: Date.now() - start,
  }
}
