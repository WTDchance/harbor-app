import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { syncStediPayers } from '@/lib/stedi/sync-payers'

export const dynamic = 'force-dynamic'

function assertCronAuthorized(req: NextRequest) {
  const auth = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    throw new Error('Unauthorized')
  }
}

export async function GET(req: NextRequest) {
  try {
    assertCronAuthorized(req)
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await syncStediPayers(supabaseAdmin)
    return NextResponse.json(result)
  } catch (err) {
    console.error('[sync-stedi-payers] unexpected error', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
