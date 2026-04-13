// Admin Health Check API
<<<<<<< HEAD
// GET /api/admin/health — runs live checks on all services
// POST /api/admin/health — runs checks + stores results + triggers alerts if needed
=======
// GET /api/admin/health â runs live checks on all services
// POST /api/admin/health â runs checks + stores results + triggers alerts if needed
>>>>>>> 7b5802070d970226728064b28eaf3b02bf52e91a
// Requires admin role

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

const SERVICES = ['harbor_app', 'vapi', 'twilio', 'supabase'] as const
type ServiceName = typeof SERVICES[number]

interface CheckResult {
  service: ServiceName
  status: 'healthy' | 'degraded' | 'down'
  response_ms: number
  error_message: string | null
  metadata: Record<string, any> | null
}

async function checkHarborApp(): Promise<CheckResult> {
  const start = Date.now()
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'https://harborreceptionist.com'}/api/auth/session`, {
      method: 'GET',
      signal: AbortSignal.timeout(10000),
    })
    const ms = Date.now() - start
    return {
      service: 'harbor_app',
      status: res.ok || res.status === 401 ? (ms > 5000 ? 'degraded' : 'healthy') : 'down',
      response_ms: ms,
      error_message: res.ok || res.status === 401 ? null : `HTTP ${res.status}`,
      metadata: { status_code: res.status },
    }
  } catch (err: any) {
    return {
      service: 'harbor_app',
      status: 'down',
      response_ms: Date.now() - start,
      error_message: err.message || 'Request failed',
      metadata: null,
    }
  }
}

async function checkVapi(): Promise<CheckResult> {
  const start = Date.now()
  const apiKey = process.env.VAPI_API_KEY
  if (!apiKey) {
    return {
      service: 'vapi',
      status: 'down',
      response_ms: 0,
      error_message: 'VAPI_API_KEY not configured',
      metadata: null,
    }
  }
  try {
    const res = await fetch('https://api.vapi.ai/assistant/0fc849bf-41a2-46e2-8d72-bb236a5cc8d2', {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10000),
    })
    const ms = Date.now() - start
    if (res.ok) {
      const data = await res.json()
      return {
        service: 'vapi',
        status: ms > 5000 ? 'degraded' : 'healthy',
        response_ms: ms,
        error_message: null,
        metadata: { assistant_name: data.name, assistant_id: data.id },
      }
    }
    return {
      service: 'vapi',
      status: res.status === 429 ? 'degraded' : 'down',
      response_ms: ms,
      error_message: `HTTP ${res.status}`,
      metadata: null,
    }
  } catch (err: any) {
    return {
      service: 'vapi',
      status: 'down',
      response_ms: Date.now() - start,
      error_message: err.message || 'Request failed',
      metadata: null,
    }
  }
}

async function checkTwilio(): Promise<CheckResult> {
  const start = Date.now()
  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  if (!sid || !token) {
    return {
      service: 'twilio',
      status: 'down',
      response_ms: 0,
      error_message: 'Twilio credentials not configured',
      metadata: null,
    }
  }
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}.json`, {
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
      },
      signal: AbortSignal.timeout(10000),
    })
    const ms = Date.now() - start
    if (res.ok) {
      const data = await res.json()
      return {
        service: 'twilio',
        status: data.status === 'active' ? (ms > 5000 ? 'degraded' : 'healthy') : 'degraded',
        response_ms: ms,
        error_message: data.status !== 'active' ? `Account status: ${data.status}` : null,
        metadata: { account_status: data.status, friendly_name: data.friendly_name },
      }
    }
    return {
      service: 'twilio',
      status: 'down',
      response_ms: ms,
      error_message: `HTTP ${res.status}`,
      metadata: null,
    }
  } catch (err: any) {
    return {
      service: 'twilio',
      status: 'down',
      response_ms: Date.now() - start,
      error_message: err.message || 'Request failed',
      metadata: null,
    }
  }
}

async function checkSupabase(): Promise<CheckResult> {
  const start = Date.now()
  try {
    const { count, error } = await supabaseAdmin
      .from('practices')
      .select('id', { count: 'exact', head: true })
    const ms = Date.now() - start
    if (error) {
      return {
        service: 'supabase',
        status: 'down',
        response_ms: ms,
        error_message: error.message,
        metadata: null,
      }
    }
    return {
      service: 'supabase',
      status: ms > 3000 ? 'degraded' : 'healthy',
      response_ms: ms,
      error_message: null,
      metadata: { practice_count: count },
    }
  } catch (err: any) {
    return {
      service: 'supabase',
      status: 'down',
      response_ms: Date.now() - start,
      error_message: err.message || 'Query failed',
      metadata: null,
    }
  }
}

async function runAllChecks(): Promise<CheckResult[]> {
  return Promise.all([
    checkHarborApp(),
    checkVapi(),
    checkTwilio(),
    checkSupabase(),
  ])
}

async function sendDowntimeAlert(results: CheckResult[]) {
  const downServices = results.filter(r => r.status === 'down')
  if (downServices.length === 0) return

  const alertPhone = process.env.ALERT_PHONE || '+15418920518' // Dr. Trace's cell as fallback
  const twilioSid = process.env.TWILIO_ACCOUNT_SID
  const twilioToken = process.env.TWILIO_AUTH_TOKEN
  const twilioFrom = process.env.TWILIO_PHONE_NUMBER

  if (!twilioSid || !twilioToken || !twilioFrom) return

  const serviceList = downServices.map(s => `${s.service}: ${s.error_message}`).join(', ')
  const message = `[Harbor Alert] Service(s) DOWN: ${serviceList}. Check admin dashboard immediately.`

  try {
    await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: 'Basic ' + Buffer.from(`${twilioSid}:${twilioToken}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          From: twilioFrom,
          To: alertPhone,
          Body: message,
        }),
      }
    )
  } catch (err) {
    console.error('[Health] Failed to send alert SMS:', err)
  }
}

<<<<<<< HEAD
// GET — live check, no storage (for dashboard refresh)
=======
// GET â live check, no storage (for dashboard refresh)
>>>>>>> 7b5802070d970226728064b28eaf3b02bf52e91a
export async function GET(req: NextRequest) {
  // Optional: allow cron/internal calls with secret
  const secret = req.nextUrl.searchParams.get('secret')
  const isCron = secret === process.env.HEALTH_CHECK_SECRET

  if (!isCron) {
    // Verify admin auth
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
  }

  const results = await runAllChecks()
  const overallStatus = results.every(r => r.status === 'healthy')
    ? 'operational'
    : results.some(r => r.status === 'down')
    ? 'outage'
    : 'degraded'

  return NextResponse.json({
    status: overallStatus,
    checked_at: new Date().toISOString(),
    services: results,
  })
}

<<<<<<< HEAD
// POST — run checks + store results + alert
=======
// POST â run checks + store results + alert
>>>>>>> 7b5802070d970226728064b28eaf3b02bf52e91a
export async function POST(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret')
  const isCron = secret === process.env.HEALTH_CHECK_SECRET

  if (!isCron) {
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
  }

  const results = await runAllChecks()

  // Store results
  const rows = results.map(r => ({
    service: r.service,
    status: r.status,
    response_ms: r.response_ms,
    error_message: r.error_message,
    metadata: r.metadata,
  }))

  await supabaseAdmin.from('health_checks').insert(rows)

  // Check for new incidents
  for (const result of results) {
    if (result.status === 'down') {
      // Check if there's an active (unresolved) incident for this service
      const { data: activeIncident } = await supabaseAdmin
        .from('incidents')
        .select('id')
        .eq('service', result.service)
        .is('resolved_at', null)
        .limit(1)
        .maybeSingle()

      if (!activeIncident) {
        // Create new incident
        await supabaseAdmin.from('incidents').insert({
          service: result.service,
          severity: 'down',
          title: `${result.service} is down`,
          description: result.error_message,
        })
      }
    } else if (result.status === 'healthy') {
      // Resolve any active incidents for this service
      const { data: activeIncident } = await supabaseAdmin
        .from('incidents')
        .select('id, started_at')
        .eq('service', result.service)
        .is('resolved_at', null)
        .limit(1)
        .maybeSingle()

      if (activeIncident) {
        const duration = Math.round(
          (Date.now() - new Date(activeIncident.started_at).getTime()) / 1000
        )
        await supabaseAdmin
          .from('incidents')
          .update({
            resolved_at: new Date().toISOString(),
            duration_seconds: duration,
          })
          .eq('id', activeIncident.id)
      }
    }
  }

  // Alert if anything is down
  await sendDowntimeAlert(results)

  const overallStatus = results.every(r => r.status === 'healthy')
    ? 'operational'
    : results.some(r => r.status === 'down')
    ? 'outage'
    : 'degraded'

  return NextResponse.json({
    status: overallStatus,
    checked_at: new Date().toISOString(),
    services: results,
    stored: true,
  })
}
