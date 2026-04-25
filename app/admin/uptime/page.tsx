"use client"

import { useState, useEffect, useCallback } from "react"
import { createClient } from "@/lib/supabase-browser"

const supabase = createClient()

type SentryIssue = {
  id: string
  title: string
  culprit: string
  level: string
  count: number
  firstSeen: string
  lastSeen: string
  permalink: string
}

type SentryData = {
  configured: boolean
  errors: {
    total: number
    byLevel: { error: number; warning: number; info: number }
    recent: SentryIssue[]
  }
  uptime: { id: string; name: string; url: string; status: string }[]
  sentryUrl: string
  fetched_at: string
}

type ServiceStatus = {
  service: string
  status: "healthy" | "degraded" | "down"
  response_ms: number
  error_message: string | null
  metadata: Record<string, any> | null
}

type LiveCheck = {
  status: "operational" | "degraded" | "outage"
  checked_at: string
  services: ServiceStatus[]
}

type Incident = {
  id: string
  service: string
  severity: string
  title: string
  description: string | null
  started_at: string
  resolved_at: string | null
  duration_seconds: number | null
}

type HistoryData = {
  period_days: number
  overall_uptime_pct: number
  uptime_by_service: Record<string, { total: number; healthy: number; uptime_pct: number; avg_response_ms: number }>
  incidents: Incident[]
  call_metrics: {
    total_calls: number
    completed_calls: number
    success_rate_pct: number
    daily: { day: string; total_calls: number; completed_calls: number; failed_calls: number; success_rate: number; avg_duration_seconds: number }[]
  }
  total_checks: number
}

const SERVICE_LABELS: Record<string, string> = {
  harbor_app: "Harbor App",
  vapi: "Vapi (Voice AI)",
  twilio: "Twilio (Phone)",
  supabase: "Supabase (Database)",
}

const SERVICE_ICONS: Record<string, string> = {
  harbor_app: "M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5",
  vapi: "M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z",
  twilio: "M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z",
  supabase: "M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4",
}

function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    healthy: "bg-green-500",
    operational: "bg-green-500",
    degraded: "bg-yellow-500",
    down: "bg-red-500",
    outage: "bg-red-500",
  }
  const pulse = status === "healthy" || status === "operational" ? "animate-pulse" : ""
  return (
    <span className={`inline-block w-3 h-3 rounded-full ${colors[status] || "bg-gray-400"} ${pulse}`} />
  )
}

function UptimeBar({ pct }: { pct: number }) {
  const color = pct >= 99.5 ? "bg-green-500" : pct >= 95 ? "bg-yellow-500" : "bg-red-500"
  return (
    <div className="w-full bg-gray-200 rounded-full h-2">
      <div className={`h-2 rounded-full ${color}`} style={{ width: `${Math.min(pct, 100)}%` }} />
    </div>
  )
}

function formatDuration(seconds: number | null) {
  if (!seconds) return "--"
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
  const hrs = Math.floor(seconds / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  return `${hrs}h ${mins}m`
}

function formatDate(d: string) {
  return new Date(d).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  })
}

export default function UptimeDashboard() {
  const [live, setLive] = useState<LiveCheck | null>(null)
  const [history, setHistory] = useState<HistoryData | null>(null)
  const [sentry, setSentry] = useState<SentryData | null>(null)
  const [loading, setLoading] = useState(true)
  const [checking, setChecking] = useState(false)
  const [period, setPeriod] = useState(30)
  const [error, setError] = useState<string | null>(null)

  const getToken = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    return session?.access_token || ""
  }, [])

  const fetchLive = useCallback(async () => {
    try {
      const token = await getToken()
      const res = await fetch("/api/admin/health", {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data = await res.json()
        setLive(data)
      }
    } catch {}
  }, [getToken])

  const fetchHistory = useCallback(async () => {
    try {
      const token = await getToken()
      const res = await fetch(`/api/admin/health/history?days=${period}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data = await res.json()
        setHistory(data)
      }
    } catch {}
  }, [getToken, period])

  const fetchSentry = useCallback(async () => {
    try {
      const token = await getToken()
      const res = await fetch("/api/admin/sentry", {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data = await res.json()
        setSentry(data)
      }
    } catch {}
  }, [getToken])

  const runCheck = async () => {
    setChecking(true)
    try {
      const token = await getToken()
      const res = await fetch("/api/admin/health", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data = await res.json()
        setLive(data)
        // Refresh history after storing
        setTimeout(fetchHistory, 500)
      }
    } catch (e: any) {
      setError(e.message)
    } finally {
      setChecking(false)
    }
  }

  useEffect(() => {
    setLoading(true)
    Promise.all([fetchLive(), fetchHistory(), fetchSentry()]).finally(() => setLoading(false))
    const interval = setInterval(() => {
      fetchLive()
      fetchHistory()
      fetchSentry()
    }, 60000) // refresh every minute
    return () => clearInterval(interval)
  }, [fetchLive, fetchHistory, fetchSentry])

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600" />
      </div>
    )
  }

  const overallStatus = live?.status || "operational"
  const statusLabel: Record<string, string> = {
    operational: "All Systems Operational",
    degraded: "Degraded Performance",
    outage: "Service Outage",
  }
  const statusBg: Record<string, string> = {
    operational: "bg-green-50 border-green-200",
    degraded: "bg-yellow-50 border-yellow-200",
    outage: "bg-red-50 border-red-200",
  }
  const statusText: Record<string, string> = {
    operational: "text-green-800",
    degraded: "text-yellow-800",
    outage: "text-red-800",
  }

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">System Health</h1>
          <p className="text-gray-500 text-sm">Monitor Ellie&apos;s uptime, response times, and call performance</p>
        </div>
        <button
          onClick={runCheck}
          disabled={checking}
          className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50 transition text-sm"
        >
          {checking ? (
            <>
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
              Checking...
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Run Health Check
            </>
          )}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 p-3 rounded-lg text-sm">{error}</div>
      )}

      {/* Overall Status Banner */}
      <div className={`border rounded-lg p-5 ${statusBg[overallStatus]}`}>
        <div className="flex items-center gap-3">
          <StatusDot status={overallStatus} />
          <span className={`text-lg font-semibold ${statusText[overallStatus]}`}>
            {statusLabel[overallStatus]}
          </span>
          {live?.checked_at && (
            <span className="text-sm text-gray-500 ml-auto">
              Last check: {formatDate(live.checked_at)}
            </span>
          )}
        </div>
      </div>

      {/* Service Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {(live?.services || []).map((svc) => (
          <div key={svc.service} className="bg-white border rounded-lg p-4 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={SERVICE_ICONS[svc.service] || ""} />
                </svg>
                <span className="font-medium text-sm text-gray-800">
                  {SERVICE_LABELS[svc.service]}
                </span>
              </div>
              <StatusDot status={svc.status} />
            </div>
            <div className="text-xs text-gray-500 space-y-1">
              <div className="flex justify-between">
                <span>Response</span>
                <span className="font-mono">{svc.response_ms}ms</span>
              </div>
              {history?.uptime_by_service[svc.service] && (
                <div className="flex justify-between">
                  <span>Uptime ({period}d)</span>
                  <span className="font-mono">
                    {history.uptime_by_service[svc.service].uptime_pct}%
                  </span>
                </div>
              )}
              {svc.error_message && (
                <div className="text-red-600 mt-1 truncate" title={svc.error_message}>
                  {svc.error_message}
                </div>
              )}
            </div>
            {history?.uptime_by_service[svc.service] && (
              <div className="mt-2">
                <UptimeBar pct={history.uptime_by_service[svc.service].uptime_pct} />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white border rounded-lg p-4 shadow-sm text-center">
          <div className="text-3xl font-bold text-gray-900">
            {history?.overall_uptime_pct ?? "--"}%
          </div>
          <div className="text-sm text-gray-500">Overall Uptime ({period}d)</div>
        </div>
        <div className="bg-white border rounded-lg p-4 shadow-sm text-center">
          <div className="text-3xl font-bold text-gray-900">
            {history?.call_metrics.total_calls ?? 0}
          </div>
          <div className="text-sm text-gray-500">Total Calls ({period}d)</div>
        </div>
        <div className="bg-white border rounded-lg p-4 shadow-sm text-center">
          <div className="text-3xl font-bold text-gray-900">
            {history?.call_metrics.success_rate_pct ?? 0}%
          </div>
          <div className="text-sm text-gray-500">Call Success Rate</div>
        </div>
        <div className="bg-white border rounded-lg p-4 shadow-sm text-center">
          <div className="text-3xl font-bold text-gray-900">
            {history?.incidents.filter(i => !i.resolved_at).length ?? 0}
          </div>
          <div className="text-sm text-gray-500">Active Incidents</div>
        </div>
      </div>

      {/* Sentry Error Monitoring */}
      {sentry?.configured && (
        <div className="bg-white border rounded-lg p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900">Error Monitoring</h2>
            <a
              href={sentry.sentryUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-teal-600 hover:text-teal-700 flex items-center gap-1"
            >
              Open Sentry
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          </div>

          {/* Error counts by level */}
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="bg-red-50 border border-red-100 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-red-700">{sentry.errors.byLevel.error}</div>
              <div className="text-xs text-red-600">Errors</div>
            </div>
            <div className="bg-yellow-50 border border-yellow-100 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-yellow-700">{sentry.errors.byLevel.warning}</div>
              <div className="text-xs text-yellow-600">Warnings</div>
            </div>
            <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-blue-700">{sentry.errors.byLevel.info}</div>
              <div className="text-xs text-blue-600">Info</div>
            </div>
          </div>

          {/* Recent unresolved issues */}
          {sentry.errors.recent.length > 0 ? (
            <div>
              <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
                Recent Unresolved Issues
              </h3>
              <div className="space-y-2">
                {sentry.errors.recent.map((issue) => (
                  <a
                    key={issue.id}
                    href={issue.permalink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block border rounded-lg p-3 hover:bg-gray-50 transition"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${
                          issue.level === "error" ? "bg-red-500" :
                          issue.level === "warning" ? "bg-yellow-500" : "bg-blue-500"
                        }`} />
                        <span className="text-sm font-medium text-gray-800 truncate">
                          {issue.title}
                        </span>
                      </div>
                      <span className="text-xs text-gray-400 shrink-0 ml-2">
                        {issue.count}x
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-gray-500 flex gap-3">
                      {issue.culprit && (
                        <span className="truncate">{issue.culprit}</span>
                      )}
                      <span className="shrink-0">Last: {formatDate(issue.lastSeen)}</span>
                    </div>
                  </a>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-500">No unresolved issues. All clear!</p>
          )}
        </div>
      )}

      {/* Sentry Uptime Monitors */}
      {sentry?.configured && sentry.uptime.length > 0 && (
        <div className="bg-white border rounded-lg p-5 shadow-sm">
          <h2 className="font-semibold text-gray-900 mb-3">External Uptime Monitors</h2>
          <div className="space-y-2">
            {sentry.uptime.map((monitor) => (
              <div key={monitor.id} className="flex items-center justify-between border rounded-lg p-3">
                <div className="flex items-center gap-3">
                  <StatusDot status={monitor.status === "active" || monitor.status === "ok" ? "healthy" : "down"} />
                  <div>
                    <div className="text-sm font-medium text-gray-800">{monitor.name}</div>
                    {monitor.url && (
                      <div className="text-xs text-gray-400">{monitor.url}</div>
                    )}
                  </div>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  monitor.status === "active" || monitor.status === "ok"
                    ? "bg-green-100 text-green-700"
                    : "bg-red-100 text-red-700"
                }`}>
                  {monitor.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Period Selector + Call Chart */}
      <div className="bg-white border rounded-lg p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-gray-900">Daily Call Volume</h2>
          <div className="flex gap-1">
            {[7, 14, 30].map(d => (
              <button
                key={d}
                onClick={() => setPeriod(d)}
                className={`px-3 py-1 rounded text-xs ${
                  period === d ? "bg-teal-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>

        {history?.call_metrics.daily && history.call_metrics.daily.length > 0 ? (
          <div className="space-y-1">
            {/* Simple bar chart */}
            {(() => {
              const maxCalls = Math.max(...history.call_metrics.daily.map(d => d.total_calls), 1)
              return history.call_metrics.daily.slice(-period).map((day) => (
                <div key={day.day} className="flex items-center gap-3 text-xs">
                  <span className="w-16 text-gray-500 shrink-0">
                    {new Date(day.day + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
                  <div className="flex-1 flex items-center gap-1">
                    <div
                      className="bg-teal-500 h-5 rounded-sm"
                      style={{ width: `${(day.completed_calls / maxCalls) * 100}%`, minWidth: day.completed_calls > 0 ? '4px' : '0' }}
                    />
                    {day.failed_calls > 0 && (
                      <div
                        className="bg-red-400 h-5 rounded-sm"
                        style={{ width: `${(day.failed_calls / maxCalls) * 100}%`, minWidth: '4px' }}
                      />
                    )}
                  </div>
                  <span className="w-20 text-right text-gray-600 shrink-0">
                    {day.total_calls} calls
                  </span>
                  <span className="w-16 text-right text-gray-400 shrink-0">
                    {day.avg_duration_seconds > 0 ? `${Math.round(day.avg_duration_seconds / 60)}m avg` : '--'}
                  </span>
                </div>
              ))
            })()}
            <div className="flex items-center gap-4 mt-2 text-xs text-gray-400">
              <span className="flex items-center gap-1"><span className="w-3 h-3 bg-teal-500 rounded-sm inline-block" /> Completed</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 bg-red-400 rounded-sm inline-block" /> Failed</span>
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-500">No call data for this period.</p>
        )}
      </div>

      {/* Incidents */}
      <div className="bg-white border rounded-lg p-5 shadow-sm">
        <h2 className="font-semibold text-gray-900 mb-3">
          Incidents ({history?.incidents.length || 0})
        </h2>
        {history?.incidents && history.incidents.length > 0 ? (
          <div className="space-y-3">
            {history.incidents.map((inc) => (
              <div key={inc.id} className="border-b pb-3 last:border-0">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <StatusDot status={inc.resolved_at ? "healthy" : "down"} />
                    <span className="font-medium text-sm">{inc.title}</span>
                    <span className="text-xs bg-gray-100 px-2 py-0.5 rounded text-gray-600">
                      {SERVICE_LABELS[inc.service] || inc.service}
                    </span>
                  </div>
                  <span className="text-xs text-gray-500">
                    {formatDate(inc.started_at)}
                  </span>
                </div>
                <div className="mt-1 text-xs text-gray-500 flex gap-4">
                  {inc.description && <span>{inc.description}</span>}
                  {inc.resolved_at ? (
                    <span className="text-green-600">
                      Resolved in {formatDuration(inc.duration_seconds)}
                    </span>
                  ) : (
                    <span className="text-red-600 font-medium">Ongoing</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-500">No incidents recorded. Looking good!</p>
        )}
      </div>

      {/* Quick Links */}
      <div className="bg-white border rounded-lg p-5 shadow-sm">
        <h2 className="font-semibold text-gray-900 mb-3">Quick Links</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {sentry?.configured && (
            <a
              href={sentry.sentryUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 border rounded-lg p-3 hover:bg-gray-50 transition text-sm text-gray-700"
            >
              <svg className="w-4 h-4 text-purple-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
              Sentry Dashboard
            </a>
          )}
          <a
            href="https://railway.app/dashboard"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 border rounded-lg p-3 hover:bg-gray-50 transition text-sm text-gray-700"
          >
            <svg className="w-4 h-4 text-indigo-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2" />
            </svg>
            Railway
          </a>
          <a
            href="https://supabase.com/dashboard"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 border rounded-lg p-3 hover:bg-gray-50 transition text-sm text-gray-700"
          >
            <svg className="w-4 h-4 text-green-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
            </svg>
            Supabase
          </a>
          <a
            href="/admin/hipaa"
            className="flex items-center gap-2 border rounded-lg p-3 hover:bg-gray-50 transition text-sm text-gray-700"
          >
            <svg className="w-4 h-4 text-teal-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
            HIPAA Audit
          </a>
        </div>
      </div>
    </div>
  )
}
