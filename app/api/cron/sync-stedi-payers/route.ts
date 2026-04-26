// Stedi payer-directory weekly sync.
// Bearer CRON_SECRET. Calls into lib/aws/stedi/sync-payers which paginates
// the Stedi API and upserts into stedi_payers.

import { NextResponse, type NextRequest } from 'next/server'
import { syncStediPayers } from '@/lib/aws/stedi/sync-payers'
import { auditSystemEvent } from '@/lib/aws/ehr/audit'
import { assertCronAuthorized } from '@/lib/cron-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const unauthorized = assertCronAuthorized(req)
  if (unauthorized) return unauthorized
  try {
    const result = await syncStediPayers()
    auditSystemEvent({
      action: 'cron.sync-stedi-payers.run',
      details: {
        total_fetched: result.totalFetched,
        upserted: result.upserted,
        eligibility_supported: result.eligibilitySupported,
        error_count: result.errors.length,
        duration_ms: result.durationMs,
      },
      severity: result.errors.length ? 'warn' : 'info',
    }).catch(() => {})
    return NextResponse.json(result)
  } catch (err) {
    console.error('[sync-stedi-payers] unexpected error', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
