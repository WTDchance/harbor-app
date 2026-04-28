// Flip the global signups_enabled kill switch in app_settings.
// Admin-only via requireAdminSession.

import { NextResponse, type NextRequest } from 'next/server'
import { requireAdminSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditSystemEvent } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const ctx = await requireAdminSession()
  if (ctx instanceof NextResponse) return ctx

  const body = await req.json().catch(() => ({})) as { enabled?: boolean }
  const enabled = body?.enabled === true

  // app_settings.value is JSONB. Boolean → JSON true/false literal.
  await pool.query(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ('signups_enabled', $1::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value,
           updated_at = NOW()`,
    [JSON.stringify(enabled)],
  )

  auditSystemEvent({
    action: 'admin.signups_enabled.toggle',
    details: { signups_enabled: enabled, by: ctx.session.email },
    severity: 'warning',
  }).catch(() => {})

  console.log(`[admin/signups/toggle] ${ctx.session.email} set signups_enabled=${enabled}`)

  return NextResponse.json({ success: true, signups_enabled: enabled })
}
