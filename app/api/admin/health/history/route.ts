// Health Check History API
// GET /api/admin/health/history — returns uptime metrics, recent checks, incidents, call metrics

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  // Auth check
  const authHeader = req.headers.get('authorization')
  if (!authHeader) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const token = authHeader.replace('Bearer ', '')
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token)
  if (error || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { data: userRecord } = await supabaseAdmin
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()
  if (!userRecord || userRecord.role !== 'admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  const days = parseInt(req.nextUrl.searchParams.get('days') || '30')
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

  // Get all checks in period
  const { data: checks } = await supabaseAdmin
    .from('health_checks')
    .select('service, status, response_ms, checked_at')
    .gte('checked_at', since)
    .order('checked_at', { ascending: false })
    .limit(5000)

  // Calculate uptime per service
  const services = ['harbor_app', 'vapi', 'twilio', 'supabase']
  const uptimeByService: Record<string, { total: number; healthy: number; uptime_pct: number; avg_response_ms: number }> = {}

  for (const svc of services) {
    const svcChecks = (checks || []).filter(c => c.service === svc)
    const healthy = svcChecks.filter(c => c.status === 'healthy').length
    const total = svcChecks.length
    const avgMs = total > 0
      ? Math.round(svcChecks.reduce((sum, c) => sum + (c.response_ms || 0), 0) / total)
      : 0
    uptimeByService[svc] = {
      total,
      healthy,
      uptime_pct: total > 0 ? Math.round((healthy / total) * 10000) / 100 : 100,
      avg_response_ms: avgMs,
    }
  }

  // Overall uptime (weighted: all services must be healthy for the check to count as "up")
  const checkTimestamps = [...new Set((checks || []).map(c => c.checked_at))]
  let allHealthyCount = 0
  for (const ts of checkTimestamps) {
    const checksAtTime = (checks || []).filter(c => c.checked_at === ts)
    if (checksAtTime.every(c => c.status === 'healthy')) {
      allHealthyCount++
    }
  }
  const overallUptime = checkTimestamps.length > 0
    ? Math.round((allHealthyCount / checkTimestamps.length) * 10000) / 100
    : 100

  // Get recent incidents
  const { data: incidents } = await supabaseAdmin
    .from('incidents')
    .select('*')
    .gte('started_at', since)
    .order('started_at', { ascending: false })
    .limit(50)

  // Get call metrics (last N days)
  const { data: callMetrics } = await supabaseAdmin
    .from('call_logs')
    .select('id, duration_seconds, crisis_detected, call_type, caller_name, created_at')
    .gte('created_at', since)
    .order('created_at', { ascending: false })

  // Aggregate call metrics by day
  const callsByDay: Record<string, { total: number; completed: number; failed: number; avg_duration: number; durations: number[] }> = {}
  for (const call of (callMetrics || [])) {
    const day = new Date(call.created_at).toISOString().split('T')[0]
    if (!callsByDay[day]) {
      callsByDay[day] = { total: 0, completed: 0, failed: 0, avg_duration: 0, durations: [] }
    }
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

  // Total call stats
  const totalCalls = (callMetrics || []).length
  const completedCalls = (callMetrics || []).filter(c => c.duration_seconds && c.duration_seconds > 0).length
  const callSuccessRate = totalCalls > 0 ? Math.round((completedCalls / totalCalls) * 100) : 0

  // Response time trend (hourly averages for last 24h)
  const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const recentChecks = (checks || []).filter(c => c.checked_at >= last24h)
  const responseByHour: Record<string, { service: string; hour: string; avg_ms: number; values: number[] }[]> = {}

  for (const check of recentChecks) {
    const hour = check.checked_at.substring(0, 13) // YYYY-MM-DDTHH
    const key = `${check.service}:${hour}`
    if (!responseByHour[key]) {
      responseByHour[key] = [{ service: check.service, hour, avg_ms: 0, values: [] }]
    }
    responseByHour[key][0].values.push(check.response_ms || 0)
  }

  return NextResponse.json({
    period_days: days,
    overall_uptime_pct: overallUptime,
    uptime_by_service: uptimeByService,
    incidents: incidents || [],
    call_metrics: {
      total_calls: totalCalls,
      completed_calls: completedCalls,
      success_rate_pct: callSuccessRate,
      daily: dailyCallMetrics,
    },
    total_checks: checkTimestamps.length,
  })
}
