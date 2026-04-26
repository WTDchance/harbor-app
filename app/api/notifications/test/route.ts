// app/api/notifications/test/route.ts
//
// Wave 23 (AWS port). The legacy version dispatched a Web Push test
// notification via web-push to all of the practice's stored
// subscriptions. Web Push dispatch is on the carrier-swap track
// (Bucket 1) — we'll re-attach it once the new push provider lands.
// For now we return 501 so the dashboard surfaces a clear message
// instead of silently no-op'ing.

import { NextResponse } from 'next/server'

export async function POST() {
  return NextResponse.json(
    {
      error: 'not_implemented',
      reason: 'web_push_dispatch_pending_bucket_1',
      detail:
        'Web Push test dispatch requires the carrier-swap migration. ' +
        'Subscriptions are still being persisted via /api/notifications/subscribe.',
    },
    { status: 501 },
  )
}
