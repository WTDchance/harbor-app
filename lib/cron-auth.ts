// Shared auth for every /api/cron/* route.
//
// Historically each cron endpoint invented its own header + env var combo
// (CRON_SECRET vs RECONCILER_SECRET; Authorization: Bearer vs x-cron-secret),
// which caused launch-day drift when the external scheduler hit an endpoint
// that expected a different pair. This helper accepts any of the valid
// combinations so all cron-job.org entries can share one header/value and
// individual routes can't silently fall out of sync.
//
// Usage:
//   const unauthorized = assertCronAuthorized(req)
//   if (unauthorized) return unauthorized
//
// Returns `null` on success; a 401 NextResponse on failure.

import { NextRequest, NextResponse } from 'next/server'

export function assertCronAuthorized(req: NextRequest): NextResponse | null {
  const secrets = [
    process.env.CRON_SECRET,
    process.env.RECONCILER_SECRET,
  ].filter((v): v is string => typeof v === 'string' && v.length > 0)

  if (secrets.length === 0) {
    // No secret configured at all — treat as misconfigured and deny.
    return NextResponse.json(
      { error: 'Server not configured with cron secret' },
      { status: 401 }
    )
  }

  const candidates: Array<string | null> = [
    req.headers.get('x-cron-secret'),
    parseBearer(req.headers.get('authorization')),
  ]

  for (const c of candidates) {
    if (!c) continue
    if (secrets.includes(c)) return null
  }

  return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
}

function parseBearer(h: string | null): string | null {
  if (!h) return null
  const m = h.match(/^Bearer\s+(.+)$/i)
  return m ? m[1].trim() : null
}
