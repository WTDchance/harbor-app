// Admin Health Check API.
//
// GET — runs live checks against harbor_app, vapi, twilio, the database.
//       Auth: either ?secret=HEALTH_CHECK_SECRET (cron) OR an admin session
//       (requireAdminSession via the Cognito ID-token cookie).
//
// POST — runs checks AND persists results into health_checks + incidents
//        AND fires the Twilio downtime alert. Held back to phase-4b: this
//        is a multi-table write with an external SMS side effect, so it
//        wants a careful audit/dedup pass before re-enabling on AWS.

import { NextResponse, type NextRequest } from 'next/server'
import { requireAdminSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SERVICES = ['harbor_app', 'vapi', 'twilio', 'database'] as const
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
    const url = process.env.NEXT_PUBLIC_APP_URL || 'https://lab.harboroffice.ai'
    const res = await fetch(`${url}/`, { method: 'GET', signal: AbortSignal.timeout(10000) })
    const ms = Date.now() - start
    return {
      service: 'harbor_app',
      status: res.ok ? (ms > 5000 ? 'degraded' : 'healthy') : 'down',
      response_ms: ms,
      error_message: res.ok ? null : `HTTP ${res.status}`,
      metadata: { status_code: res.status },
    }
  } catch (err) {
    return {
      service: 'harbor_app',
      status: 'down',
      response_ms: Date.now() - start,
      error_message: (err as Error).message || 'Request failed',
      metadata: null,
    }
  }
}

async function checkVapi(): Promise<CheckResult> {
  const start = Date.now()
  const apiKey = process.env.VAPI_API_KEY
  if (!apiKey) {
    return {
      service: 'vapi', status: 'down', response_ms: 0,
      error_message: 'VAPI_API_KEY not configured', metadata: null,
    }
  }
  try {
    const res = await fetch('https://api.vapi.ai/assistant/0fc849bf-41a2-46e2-8d72-bb236a5cc8d2', {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10000),
    })
    const ms = Date.now() - start
    if (res.ok) {
      const data = await res.json() as { name?: string; id?: string }
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
  } catch (err) {
    return {
      service: 'vapi', status: 'down', response_ms: Date.now() - start,
      error_message: (err as Error).message || 'Request failed', metadata: null,
    }
  }
}

async function checkTwilio(): Promise<CheckResult> {
  const start = Date.now()
  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  if (!sid || !token) {
    return {
      service: 'twilio', status: 'down', response_ms: 0,
      error_message: 'Twilio credentials not configured', metadata: null,
    }
  }
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}.json`, {
      headers: { Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64') },
      signal: AbortSignal.timeout(10000),
    })
    const ms = Date.now() - start
    if (res.ok) {
      const data = await res.json() as { status?: string; friendly_name?: string }
      return {
        service: 'twilio',
        status: data.status === 'active' ? (ms > 5000 ? 'degraded' : 'healthy') : 'degraded',
        response_ms: ms,
        error_message: data.status !== 'active' ? `Account status: ${data.status}` : null,
        metadata: { account_status: data.status, friendly_name: data.friendly_name },
      }
    }
    return {
      service: 'twilio', status: 'down', response_ms: ms,
      error_message: `HTTP ${res.status}`, metadata: null,
    }
  } catch (err) {
    return {
      service: 'twilio', status: 'down', response_ms: Date.now() - start,
      error_message: (err as Error).message || 'Request failed', metadata: null,
    }
  }
}

async function checkDatabase(): Promise<CheckResult> {
  const start = Date.now()
  try {
    const { rows } = await pool.query(`SELECT COUNT(*)::int AS practice_count FROM practices`)
    const ms = Date.now() - start
    return {
      service: 'database',
      status: ms > 3000 ? 'degraded' : 'healthy',
      response_ms: ms,
      error_message: null,
      metadata: { practice_count: rows[0]?.practice_count ?? 0 },
    }
  } catch (err) {
    return {
      service: 'database', status: 'down', response_ms: Date.now() - start,
      error_message: (err as Error).message || 'Query failed', metadata: null,
    }
  }
}

async function runAllChecks(): Promise<CheckResult[]> {
  return Promise.all([checkHarborApp(), checkVapi(), checkTwilio(), checkDatabase()])
}

export async function GET(req: NextRequest) {
  const cronSecret = req.nextUrl.searchParams.get('secret')
  const isCron = cronSecret && cronSecret === process.env.HEALTH_CHECK_SECRET

  if (!isCron) {
    const ctx = await requireAdminSession()
    if (ctx instanceof NextResponse) return ctx
  }

  const results = await runAllChecks()
  const overall =
    results.every(r => r.status === 'healthy') ? 'operational' :
    results.some(r => r.status === 'down')     ? 'outage'      :
                                                  'degraded'

  return NextResponse.json({
    status: overall,
    checked_at: new Date().toISOString(),
    services: results,
  })
}

// TODO(phase-4b): port POST. Persists results to health_checks, opens/
// resolves rows in incidents, fires the Twilio downtime alert. Multi-table
// write + external SMS — wants its own dedup/audit design pass.
export async function POST() {
  return NextResponse.json(
    { error: 'health_check_persist_not_implemented_on_aws_yet' },
    { status: 501 },
  )
}
