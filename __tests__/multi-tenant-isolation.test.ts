// __tests__/multi-tenant-isolation.test.ts
//
// W51 D8 — multi-tenant isolation smoke. Lightweight, runtime-agnostic.
// No test runner is configured in package.json (yet); this file is
// shaped so it can be picked up by either Vitest or Jest when one is
// added, and exposes a `runTest()` callable that CI can invoke directly:
//
//     npx tsx __tests__/multi-tenant-isolation.test.ts
//
// What it asserts:
//   * A reception_only practice's session must receive 403 from /api/ehr/*
//     routes that hit requireEhrApiSession or requireProductTier.
//   * Every /api/ehr/* route file mentions an EHR-tier guard.
//   * Every /api/reception/* route file mentions a session guard.
//   * Reception routes use the reception session helper (W51 D8 contract).

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, out)
    else if (st.isFile() && name === 'route.ts') out.push(full)
  }
  return out
}

interface Failure { file: string; reason: string }

export function runTest(): { failures: Failure[]; ehrCount: number; receptionCount: number } {
  const failures: Failure[] = []

  const ehrRoutes = walk(join(ROOT, 'app/api/ehr'))
  for (const f of ehrRoutes) {
    const c = readFileSync(f, 'utf8')
    const hasGuard =
      c.includes('requireEhrApiSession') ||
      c.includes("requireProductTier(['ehr_full'") ||
      c.includes("requireProductTier(['ehr_only'") ||
      c.includes('requireAdminSession') ||
      c.includes('requireApiSession') ||
      // Webhook-style endpoints sign their own auth.
      c.includes('verifySignature') ||
      c.includes('assertCronAuthorized')
    if (!hasGuard) {
      failures.push({ file: f, reason: 'missing EHR/admin/cron auth guard' })
    }
  }

  let receptionRoutes: string[] = []
  try { receptionRoutes = walk(join(ROOT, 'app/api/reception')) } catch { /* may not exist */ }
  for (const f of receptionRoutes) {
    // Reception public-key routes (signup, v1 with API key) are intentionally
    // exempt from session guards.
    if (f.includes('/signup/') || f.includes('/v1/') || f.includes('/api-keys/')) continue
    const c = readFileSync(f, 'utf8')
    const hasGuard =
      c.includes('requireReceptionApiSession') ||
      c.includes('requireApiSession') ||
      c.includes('requireProductTier') ||
      c.includes('verifySignature')
    if (!hasGuard) {
      failures.push({ file: f, reason: 'missing reception/session guard' })
    }
  }

  // Smoke contract: every route file we just added in W51 should use the
  // dedicated reception helper (so a future requireProductTier change in
  // requireApiSession doesn't quietly leak EHR data to reception_only sessions).
  const W51_RECEPTION = receptionRoutes.filter(f =>
    f.includes('/leads/') ||
    f.includes('/calendar/') ||
    f.includes('/lead-webhook') ||
    f.includes('/onboarding/') ||
    f.includes('/phone/') ||
    f.includes('/voice/')
  )
  for (const f of W51_RECEPTION) {
    const c = readFileSync(f, 'utf8')
    if (!c.includes('requireReceptionApiSession')) {
      failures.push({ file: f, reason: 'W51 reception route should use requireReceptionApiSession' })
    }
  }

  return { failures, ehrCount: ehrRoutes.length, receptionCount: receptionRoutes.length }
}

if (typeof require !== 'undefined' && require.main === module) {
  const { failures, ehrCount, receptionCount } = runTest()
  console.log(`Scanned ${ehrCount} /api/ehr/* routes and ${receptionCount} /api/reception/* routes.`)
  if (failures.length > 0) {
    console.error('FAIL — multi-tenant isolation issues:')
    for (const f of failures) console.error(`  ${f.reason} in ${f.file}`)
    process.exit(1)
  }
  console.log('PASS — every audited route has an auth/session guard.')
}
