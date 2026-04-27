// Admin Health Check API.
//
// GET — runs live checks against harbor_app, retell, signalwire, the database.
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

const SERVICES = ['harbor_app', 'retell', 'signalwire', 'database'] as const
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

async function checkRetell(): Promise<CheckResult> {
  const start = Date.now()
  const apiKey = process.env.RETELL_API_KEY
  const agentId = process.env.RETELL_AGENT_ID
  if (!apiKey || !agentId) {
    return {
      service: 'retell', status: 'down', response_ms: 0,
      error_message: 'RETELL_API_KEY / RETELL_AGENT_ID not configured', metadata: null,
    }
  }
  try {
    const res = await fetch(`https://api.retellai.com/get-agent/${agentId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10000),
    })
    const ms = Date.now() - start
    if (res.ok) {
      const data = await res.json() as { agent_name?: string; agent_id?: string; voice_id?: string }
      return {
        service: 'retell',
        status: ms > 5000 ? 'degraded' : 'healthy',
        response_ms: ms,
        error_message: null,
        metadata: { agent_name: data.agent_name, agent_id: data.agent_id, voice_id: data.voice_id },
      }
    }
    return {
      service: 'retell',
      status: res.status === 429 ? 'degraded' : 'down',
      response_ms: ms,
      error_message: `HTTP ${res.status}`,
      metadata: null,
    }
  } catch (err) {
    return {
      service: 'retell', status: 'down', response_ms: Date.now() - start,
      error_message: (err as Error).message || 'Request failed', metadata: null,
    }
  }
}

async function checkSignalWire(): Promise<CheckResult> {
  const start = Date.now()
  const projectId = process.env.SIGNALWIRE_PROJECT_ID
  const token = process.env.SIGNALWIRE_TOKEN
  const space = process.env.SIGNALWIRE_SPACE_URL
  if (!projectId || !token || !space) {
    return {
      service: 'signalwire', status: 'down', response_ms: 0,
      error_message: 'SignalWire credentials not configured', metadata: null,
    }
  }
  try {
    const auth = 'Basic ' + Buffer.from(`${projectId}:${token}`).toString('base64')
    const res = await fetch(`https://${space}/api/laml/2010-04-01/Accounts/${projectId}.json`, {
      headers: { Authorization: auth },
      signal: AbortSignal.timeout(10000),
    })
    const ms = Date.now() - start
    if (res.ok) {
      const data = await res.json() as { status?: string; friendly_name?: string; type?: string }
      const isActive = data.status === 'active'
      return {
        service: 'signalwire',
        status: isActive ? (ms > 5000 ? 'degraded' : 'healthy') : 'degraded',
        response_ms: ms,
        error_message: isActive ? null : `Account status: ${data.status}`,
        metadata: {
          account_status: data.status,
          friendly_name: data.friendly_name,
          account_type: data.type,
        },
      }
    }
    return {
      service: 'signalwire', status: 'down', response_ms: ms,
      error_message: `HTTP ${res.status}`, metadata: null,
    }
  } catch (err) {
    return {
      service: 'signalwire', status: 'down', response_ms: Date.now() - start,
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
  return Promise.all([checkHarborApp(), checkRetell(), checkSignalWire(), checkDatabase()])
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
