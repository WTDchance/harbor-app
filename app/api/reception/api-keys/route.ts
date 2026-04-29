// app/api/reception/api-keys/route.ts
//
// W48 T5 — therapist-side CRUD for the practice's reception API
// keys. Reads use Cognito session (same as other dashboard APIs),
// not API keys themselves.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { generateApiKey } from '@/lib/aws/reception/generate-api-key'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ALLOWED_SCOPES = new Set([
  'agents:read', 'agents:write',
  'calls:read',
  'appointments:read', 'appointments:write',
])

export async function GET() {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const { rows } = await pool.query(
    `SELECT id::text, key_prefix, scopes, created_at, last_used_at, revoked_at
       FROM reception_api_keys
      WHERE practice_id = $1
      ORDER BY revoked_at NULLS FIRST, created_at DESC`,
    [ctx.practiceId],
  )
  return NextResponse.json({ keys: rows })
}

export async function POST(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const body = await req.json().catch(() => null)
  const scopes: string[] = Array.isArray(body?.scopes) ? body.scopes : []
  const filtered = scopes.filter((s) => ALLOWED_SCOPES.has(s))
  if (filtered.length === 0) {
    return NextResponse.json({ error: 'at_least_one_scope_required' }, { status: 400 })
  }

  const minted = await generateApiKey(ctx.practiceId!, filtered, ctx.user.id)

  return NextResponse.json({
    id: minted.key_id,
    plaintext: minted.plaintext,
    prefix: minted.key_prefix,
    scopes: filtered,
  })
}
