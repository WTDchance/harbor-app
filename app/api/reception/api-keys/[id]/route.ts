// app/api/reception/api-keys/[id]/route.ts
//
// W48 T5 — revoke a Reception API key. Owner-only via Cognito
// session (NOT via the key itself; we'd never let a key revoke
// itself).

import { NextResponse, type NextRequest } from 'next/server'
import { requireReceptionApiSession } from '@/lib/aws/api-auth'
import { revokeApiKey } from '@/lib/aws/reception/generate-api-key'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireReceptionApiSession()
  if (ctx instanceof NextResponse) return ctx

  const ok = await revokeApiKey({ keyId: params.id, practiceId: ctx.practiceId })
  if (!ok) return NextResponse.json({ error: 'not_found_or_already_revoked' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
