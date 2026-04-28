// Wave 47 — Reception product split.
//
// Higher-order wrapper for /api/reception/v1/* route handlers. Verifies
// the Bearer API key, attaches { practice_id, scopes } to the handler,
// and emits 401 if missing/invalid.
//
// Usage:
//   export const GET = withReceptionAuth(async (req, ctx) => {
//     return NextResponse.json({ practice_id: ctx.practice_id })
//   })

import { NextRequest, NextResponse } from 'next/server'
import { verifyApiKey, type ApiKeyContext } from './api-key-auth'

export type ReceptionHandler = (
  req: NextRequest,
  ctx: ApiKeyContext,
) => Promise<NextResponse> | NextResponse

export function withReceptionAuth(handler: ReceptionHandler) {
  return async (req: NextRequest): Promise<NextResponse> => {
    const ctx = await verifyApiKey(req)
    if (!ctx) {
      return NextResponse.json(
        { error: 'unauthorized', message: 'Missing or invalid Bearer API key.' },
        { status: 401 },
      )
    }
    return handler(req, ctx)
  }
}

export function requireScope(ctx: ApiKeyContext, scope: string): NextResponse | null {
  if (!ctx.scopes.includes(scope)) {
    return NextResponse.json(
      { error: 'forbidden', message: `Missing required scope: ${scope}` },
      { status: 403 },
    )
  }
  return null
}
