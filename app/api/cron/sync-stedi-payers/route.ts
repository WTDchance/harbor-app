import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { assertCronAuthorized } from '@/lib/cron-auth'
import { syncStediPayers } from '@/lib/stedi/sync-payers'

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

  try {
    const result = await syncStediPayers(supabaseAdmin)

    if (result.errors.length > 0) {
      console.error('[sync-stedi-payers] errors:', result.errors)
    }

    return NextResponse.json({
      ok: result.errors.length === 0,
      totalFetched: result.totalFetched,
      upserted: result.upserted,
      eligibilitySupported: result.eligibilitySupported,
      errors: result.errors,
      durationMs: result.durationMs,
    })
  } catch (err) {
    console.error('[sync-stedi-payers] unexpected error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Sync failed' },
      { status: 500 }
    )
  }
}
