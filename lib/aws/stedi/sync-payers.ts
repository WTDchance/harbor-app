// Stedi payer-directory sync (AWS port via pool).
//
// Paginates through Stedi's payer list (100 per page, ~37 pages total)
// and upserts into stedi_payers. Run weekly via /api/cron/sync-stedi-payers.

import { pool } from '@/lib/aws/db'

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

export async function syncStediPayers(): Promise<SyncResult> {
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

    const data = await res.json() as { items?: StediPayer[]; nextPageToken?: string }
    const items: StediPayer[] = data.items ?? []
    allPayers.push(...items)
    nextPageToken = data.nextPageToken ?? null
    page++
    if (!nextPageToken || items.length === 0) break
  }

  const errors: string[] = []
  let upserted = 0
  let eligCount = 0
  const nowIso = new Date().toISOString()

  // Insert one row at a time inside a transaction. Could batch via VALUES
  // expansion but per-row is simpler and the data shape (text[] + jsonb)
  // makes parameter binding clearer.
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    for (const p of allPayers) {
      const ts = p.transactionSupport ?? {}
      const eligSupported = ts.eligibilityCheck === 'SUPPORTED'
      const claimSupported =
        ts.claimSubmission === 'SUPPORTED' ||
        ts.professionalClaimSubmission === 'SUPPORTED' ||
        ts.institutionalClaimSubmission === 'SUPPORTED'
      const statusSupported = ts.claimStatus === 'SUPPORTED'
      if (eligSupported) eligCount++

      try {
        await client.query(
          `INSERT INTO stedi_payers (
             stedi_id, display_name, primary_payer_id,
             aliases, names,
             eligibility_supported, claim_submission_supported, claim_status_supported,
             operating_states, raw_transaction_support, avatar_url, website_url,
             synced_at
           ) VALUES (
             $1, $2, $3,
             $4::jsonb, $5::jsonb,
             $6, $7, $8,
             $9::text[], $10::jsonb, $11, $12,
             $13
           )
           ON CONFLICT (stedi_id) DO UPDATE SET
             display_name = EXCLUDED.display_name,
             primary_payer_id = EXCLUDED.primary_payer_id,
             aliases = EXCLUDED.aliases,
             names = EXCLUDED.names,
             eligibility_supported = EXCLUDED.eligibility_supported,
             claim_submission_supported = EXCLUDED.claim_submission_supported,
             claim_status_supported = EXCLUDED.claim_status_supported,
             operating_states = EXCLUDED.operating_states,
             raw_transaction_support = EXCLUDED.raw_transaction_support,
             avatar_url = EXCLUDED.avatar_url,
             website_url = EXCLUDED.website_url,
             synced_at = EXCLUDED.synced_at`,
          [
            p.stediId, p.displayName, p.primaryPayerId ?? null,
            JSON.stringify(p.aliases ?? []), JSON.stringify(p.names ?? []),
            eligSupported, claimSupported, statusSupported,
            p.operatingStates ?? [], JSON.stringify(ts), p.avatarUrl ?? null, p.urls?.website ?? null,
            nowIso,
          ],
        )
        upserted++
      } catch (err) {
        errors.push(`${p.stediId}: ${(err as Error).message}`)
      }
    }
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    errors.push(`tx: ${(err as Error).message}`)
  } finally {
    client.release()
  }

  return {
    totalFetched: allPayers.length,
    upserted,
    eligibilitySupported: eligCount,
    errors,
    durationMs: Date.now() - start,
  }
}
