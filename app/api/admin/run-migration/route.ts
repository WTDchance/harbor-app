// app/api/admin/run-migration/route.ts
//
// Wave 18 (AWS port). Apply ad-hoc SQL migrations to RDS. Used to
// roll out schema bumps (column adds, index creates) without redeploying
// the app. The legacy version on Supabase only worked around supabase-js
// not supporting raw SQL by probing column existence; this AWS version
// has a real pool and can execute SQL directly.
//
// Auth: requireAdminSession() — Cognito session must match
// ADMIN_EMAIL allowlist.
//
// Audit captures: admin email + statement_count + payload SHA-256 hash.
// Raw SQL is NOT stored to keep audit_logs from leaking secrets, but
// the hash makes after-the-fact verification possible (a regulator can
// re-hash an asserted payload and compare).
//
// Each statement runs in its own transaction so a partial migration
// only fails the offending statement and leaves prior statements
// committed.
//
// Body shape:
//   { statements: string[] }   — list of SQL statements
//   { sql: string }            — single statement (legacy convenience)

import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/aws/db'
import { requireAdminSession } from '@/lib/aws/api-auth'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
import { hashAdminPayload } from '@/lib/aws/admin/payload-hash'

export async function POST(req: NextRequest) {
  const ctx = await requireAdminSession()
  if (ctx instanceof NextResponse) return ctx

  let body: { statements?: unknown; sql?: unknown }
  try {
    body = (await req.json()) as { statements?: unknown; sql?: unknown }
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const stmts: string[] = Array.isArray(body.statements)
    ? body.statements.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    : typeof body.sql === 'string' && body.sql.trim().length > 0
      ? [body.sql]
      : []

  if (stmts.length === 0) {
    return NextResponse.json({ error: 'statements (string[]) or sql (string) required' }, { status: 400 })
  }

  const payloadHash = hashAdminPayload({ statements: stmts })
  const results: Array<{ ok: boolean; rows_affected?: number; error?: string }> = []

  for (const stmt of stmts) {
    try {
      const r = await pool.query(stmt)
      results.push({ ok: true, rows_affected: r.rowCount ?? 0 })
    } catch (err) {
      results.push({ ok: false, error: (err as Error).message })
    }
  }

  await auditEhrAccess({
    ctx,
    action: 'admin.run_migration',
    resourceType: 'rds_migration',
    resourceId: null,
    details: {
      admin_email: ctx.session.email,
      statement_count: stmts.length,
      success_count: results.filter((r) => r.ok).length,
      failure_count: results.filter((r) => !r.ok).length,
      payload_hash: payloadHash,
    },
  })

  const allOk = results.every((r) => r.ok)
  return NextResponse.json(
    { ok: allOk, statement_count: stmts.length, results, payload_hash: payloadHash },
    { status: allOk ? 200 : 207 },
  )
}
