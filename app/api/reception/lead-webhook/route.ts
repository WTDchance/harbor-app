// W51 D4 — read / upsert the lead webhook config + recent deliveries.

import { NextResponse, type NextRequest } from 'next/server'
import { requireReceptionApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { writeAuditLog } from '@/lib/audit'
import { encryptToken } from '@/lib/aws/token-encryption'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ALLOWED_EVENTS = new Set(['lead.created', 'lead.updated', 'lead.exported'])

export async function GET() {
  const ctx = await requireReceptionApiSession()
  if (ctx instanceof NextResponse) return ctx
  if (!ctx.practiceId) return NextResponse.json({ config: null, recent: [] })

  const cfg = await pool.query(
    `SELECT id, webhook_url, event_types, enabled, updated_at
       FROM practice_lead_webhook_config WHERE practice_id = $1 LIMIT 1`,
    [ctx.practiceId],
  )
  const recent = await pool.query(
    `SELECT id, event_type, url, attempt, http_status, delivered_at,
            failed_reason, next_attempt_at, created_at
       FROM lead_webhook_deliveries
      WHERE practice_id = $1
      ORDER BY created_at DESC LIMIT 25`,
    [ctx.practiceId],
  )
  return NextResponse.json({ config: cfg.rows[0] ?? null, recent: recent.rows })
}

export async function PUT(req: NextRequest) {
  const ctx = await requireReceptionApiSession()
  if (ctx instanceof NextResponse) return ctx
  if (!ctx.practiceId) return NextResponse.json({ error: 'no_practice' }, { status: 400 })

  const body = await req.json().catch(() => null) as
    { webhook_url?: string; webhook_secret?: string; event_types?: string[]; enabled?: boolean } | null
  if (!body) return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  const url = String(body.webhook_url ?? '').trim()
  if (!/^https?:\/\//.test(url)) return NextResponse.json({ error: 'invalid_url' }, { status: 400 })

  const secret = String(body.webhook_secret ?? '').slice(0, 200)
  if (!secret) return NextResponse.json({ error: 'webhook_secret_required' }, { status: 400 })
  const events = (Array.isArray(body.event_types) ? body.event_types : ['lead.created', 'lead.updated'])
    .filter((s: unknown): s is string => typeof s === 'string' && ALLOWED_EVENTS.has(s))
  const enabled = body.enabled !== false
  const enc = await encryptToken(secret)

  const upsert = await pool.query(
    `INSERT INTO practice_lead_webhook_config
       (practice_id, webhook_url, webhook_secret_encrypted, event_types, enabled)
     VALUES ($1, $2, $3, $4::text[], $5)
     ON CONFLICT (practice_id) DO UPDATE SET
       webhook_url = EXCLUDED.webhook_url,
       webhook_secret_encrypted = EXCLUDED.webhook_secret_encrypted,
       event_types = EXCLUDED.event_types,
       enabled = EXCLUDED.enabled
     RETURNING id, webhook_url, event_types, enabled, updated_at`,
    [ctx.practiceId, url, enc, events, enabled],
  )
  await writeAuditLog({
    practice_id: ctx.practiceId, user_id: ctx.user.id,
    action: 'lead_webhook.configured',
    resource_type: 'practice_lead_webhook_config',
    resource_id: upsert.rows[0].id,
    severity: 'info',
    details: { event_types: events, enabled, url_host: new URL(url).host },
  })
  return NextResponse.json({ config: upsert.rows[0] })
}

export async function DELETE() {
  const ctx = await requireReceptionApiSession()
  if (ctx instanceof NextResponse) return ctx
  if (!ctx.practiceId) return NextResponse.json({ error: 'no_practice' }, { status: 400 })

  await pool.query(`DELETE FROM practice_lead_webhook_config WHERE practice_id = $1`, [ctx.practiceId])
  await writeAuditLog({
    practice_id: ctx.practiceId, user_id: ctx.user.id,
    action: 'lead_webhook.removed', resource_type: 'practice_lead_webhook_config', severity: 'info',
  })
  return NextResponse.json({ ok: true })
}
