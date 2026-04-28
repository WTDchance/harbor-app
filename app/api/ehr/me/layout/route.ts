// app/api/ehr/me/layout/route.ts
//
// W46 T6 — read + update the signed-in user's dashboard widget +
// sidebar module preferences.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
import {
  isValidWidgetId, resolveWidgetLayout, type WidgetId,
} from '@/lib/ui/widget-registry'
import {
  isValidSidebarId, resolveSidebarLayout, type SidebarModuleId,
} from '@/lib/ui/sidebar-registry'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function sanitize<T extends string>(arr: unknown, validate: (s: string) => s is T): T[] | null {
  if (!Array.isArray(arr)) return null
  const seen = new Set<T>()
  const out: T[] = []
  for (const v of arr) {
    if (typeof v !== 'string') continue
    if (!validate(v)) continue
    if (seen.has(v as T)) continue
    seen.add(v as T)
    out.push(v as T)
  }
  return out
}

export async function GET() {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const r = await pool.query(
    `SELECT u.dashboard_widgets, u.sidebar_modules,
            p.default_dashboard_widgets, p.default_sidebar_modules
       FROM users u
       JOIN practices p ON p.id = u.practice_id
      WHERE u.id = $1 LIMIT 1`,
    [ctx.userId],
  )
  const row = r.rows[0] ?? {}

  const widgets = resolveWidgetLayout(
    row.dashboard_widgets as WidgetId[] | null,
    row.default_dashboard_widgets as WidgetId[] | null,
  )
  const sidebar = resolveSidebarLayout(
    row.sidebar_modules as SidebarModuleId[] | null,
    row.default_sidebar_modules as SidebarModuleId[] | null,
  )

  return NextResponse.json({
    widgets,
    sidebar: sidebar.map((m) => m.id),
    user_pref_widgets: row.dashboard_widgets ?? null,
    user_pref_sidebar: row.sidebar_modules ?? null,
    practice_default_widgets: row.default_dashboard_widgets ?? null,
    practice_default_sidebar: row.default_sidebar_modules ?? null,
  })
}

export async function PATCH(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'invalid_json' }, { status: 400 })

  const widgets = sanitize<WidgetId>(body.widgets, isValidWidgetId)
  const sidebar = sanitize<SidebarModuleId>(body.sidebar, isValidSidebarId)

  // PATCH supports null to clear (reset to default).
  const fields: string[] = []
  const args: any[] = []
  if (body.widgets === null) {
    args.push(null); fields.push(`dashboard_widgets = $${args.length}::jsonb`)
  } else if (widgets !== null) {
    args.push(JSON.stringify(widgets)); fields.push(`dashboard_widgets = $${args.length}::jsonb`)
  }
  if (body.sidebar === null) {
    args.push(null); fields.push(`sidebar_modules = $${args.length}::jsonb`)
  } else if (sidebar !== null) {
    args.push(JSON.stringify(sidebar)); fields.push(`sidebar_modules = $${args.length}::jsonb`)
  }

  if (fields.length === 0) return NextResponse.json({ error: 'no_fields' }, { status: 400 })

  args.push(ctx.userId)
  await pool.query(
    `UPDATE users SET ${fields.join(', ')} WHERE id = $${args.length}`,
    args,
  )

  const cleared = body.widgets === null && body.sidebar === null
  await auditEhrAccess({
    ctx,
    action: cleared ? 'user_layout.reset_to_default' : 'user_layout.updated',
    resourceType: 'user_layout',
    details: {
      widget_count: widgets?.length ?? null,
      sidebar_count: sidebar?.length ?? null,
      cleared,
    },
  })

  return NextResponse.json({ ok: true })
}
