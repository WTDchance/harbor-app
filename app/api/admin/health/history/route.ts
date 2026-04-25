// Admin Health Check History — uptime, recent checks, incidents, call metrics.
//
// Tables consulted:
//   - health_checks   (rolling window of POST /api/admin/health results)
//   - incidents       (open/resolved downtime markers)
//   - call_logs       (success-rate / volume trends)
//
// health_checks + incidents may not exist on every RDS cluster — empty
// fallbacks rather than 500s.

import { NextResponse, type NextRequest } from 'next/server'
import { requireAdminSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SERVICES = ['harbor_app', 'vapi', 'twilio', 'database', 'supabase'] as const

export async function GET(req: NextRequest) {
  const ctx = await requireAdminSession()
  if (ctx instanceof NextResponse) return ctx

  const days = Math.max(Number(req.nextUrl.searchParams.get('days') ?? 30), 1)
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

  const checksResult = await pool
    .query(
      `SELECT service, status, response_ms, checked_at
         FROM health_checks
        WHERE checked_at >= $1
        ORDER BY checked_at DESC
        LIMIT 5000`,
      [since],
    )
    .catch(() => ({ rows: [] as any[] }))
  const checks = checksResult.rows

  // Per-service uptime + average response time.
  const uptimeByService: Record<string, {
    total: number; healthy: number; uptime_pct: number; avg_response_ms: number
  }> = {}
  for (const svc of SERVICES) {
    const svcChecks = checks.filter(c => c.service === svc)
    const total = svcChecks.length
    const healthy = svcChecks.filter(c => c.status === 'healthy').length
    const avgMs = total > 0
      ? Math.round(svcChecks.reduce((s, c) => s + (c.response_ms || 0), 0) / total)
      : 0
    uptimeByService[svc] = {
      total, healthy,
      uptime_pct: total > 0 ? Math.round((healthy / total) * 10000) / 100 : 100,
      avg_response_ms: avgMs,
    }
  }

  // Overall uptime — a check window counts as "up" only when every recorded
  // service was healthy in that window.
  const checkTimestamps = Array.from(new Set(checks.map(c => c.checked_at)))
  let allHealthyCount = 0
  for (const ts of checkTimestamps) {
    const at = checks.filter(c => c.checked_at === ts)
    if (at.length > 0 && at.every(c => c.status === 'healthy')) allHealthyCount++
  }
  const overallUptime = checkTimestamps.length > 0
    ? Math.round((allHealthyCount / checkTimestamps.length) * 10000) / 100
    : 100

  const incidentsResult = await pool
    .query(
      `SELECT id, service, severity, title, description,
              started_at, resolved_at, duration_seconds
         FROM incidents
        WHERE started_at >= $1
        ORDER BY started_at DESC
        LIMIT 50`,
      [since],
    )
    .catch(() => ({ rows: [] as any[] }))

  // Call volume + success rate.
  const callsResult = await pool
    .query(
      `SELECT id, duration_seconds, crisis_detected, started_at
         FROM call_logs
        WHERE started_at >= $1
        ORDER BY started_at DESC`,
      [since],
    )
    .catch(() => ({ rows: [] as any[] }))
  const callMetrics = callsResult.rows

  type DayBucket = {
    total: number; completed: number; failed: number; durations: number[]
  }
  const callsByDay: Record<string, DayBucket> = {}
  for (const call of callMetrics) {
    const day = new Date(call.started_at).toISOString().slice(0, 10)
    if (!callsByDay[day]) callsByDay[day] = { total: 0, completed: 0, failed: 0, durations: [] }
    callsByDay[day].total++
    if (call.duration_seconds && call.duration_seconds > 0) {
      callsByDay[day].completed++
      callsByDay[day].durations.push(call.duration_seconds)
    } else {
      callsByDay[day].failed++
    }
  }
  const dailyCallMetrics = Object.entries(callsByDay)
    .map(([day, data]) => ({
      day,
      total_calls: data.total,
      completed_calls: data.completed,
      failed_calls: data.failed,
      success_rate: data.total > 0 ? Math.round((data.completed / data.total) * 100) : 0,
      avg_duration_seconds: data.durations.length > 0
        ? Math.round(data.durations.reduce((a, b) => a + b, 0) / data.durations.length)
        : 0,
    }))
    .sort((a, b) => a.day.localeCompare(b.day))

  const totalCalls = callMetrics.length
  const completedCalls = callMetrics.filter(c => c.duration_seconds && c.duration_seconds > 0).length
  const callSuccessRate = totalCalls > 0 ? Math.round((completedCalls / totalCalls) * 100) : 0

  return NextResponse.json({
    period_days: days,
    overall_uptime_pct: overallUptime,
    uptime_by_service: uptimeByService,
    incidents: incidentsResult.rows,
    call_metrics: {
      total_calls: totalCalls,
      completed_calls: completedCalls,
      success_rate_pct: callSuccessRate,
      daily: dailyCallMetrics,
    },
    total_checks: checkTimestamps.length,
  })
}
