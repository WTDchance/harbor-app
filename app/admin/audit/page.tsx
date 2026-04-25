'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { Shield, Download, Search, ChevronLeft, ChevronRight, Filter } from 'lucide-react'

interface AuditLog {
  id: string
  timestamp: string
  action: string
  severity: string
  user_email: string | null
  user_id: string | null
  practice_id: string | null
  resource_type: string | null
  resource_id: string | null
  ip_address: string | null
  user_agent: string | null
  details: Record<string, unknown>
}

interface Practice {
  id: string
  name: string
}

const SEVERITY_COLORS: Record<string, string> = {
  info: 'bg-blue-100 text-blue-800',
  warn: 'bg-yellow-100 text-yellow-800',
  error: 'bg-red-100 text-red-800',
  critical: 'bg-red-200 text-red-900 font-semibold',
}

const PAGE_SIZE = 50

export default function AdminAuditPage() {
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [practices, setPractices] = useState<Practice[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(0)

  // Filters
  const [selectedPractice, setSelectedPractice] = useState('')
  const [actionFilter, setActionFilter] = useState('')
  const [severityFilter, setSeverityFilter] = useState('')
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() - 30)
    return d.toISOString().slice(0, 10)
  })
  const [toDate, setToDate] = useState(() => new Date().toISOString().slice(0, 10))

  const supabase = createClient()

  // Load practices for dropdown
  useEffect(() => {
    async function loadPractices() {
      const { data } = await supabase
        .from('practices')
        .select('id, name')
        .order('name')
      setPractices(data ?? [])
    }
    loadPractices()
  }, [])

  // Load audit logs
  const loadLogs = useCallback(async () => {
    setLoading(true)
    try {
      let query = supabase
        .from('audit_logs')
        .select('*', { count: 'exact' })
        .gte('timestamp', `${fromDate}T00:00:00Z`)
        .lte('timestamp', `${toDate}T23:59:59Z`)
        .order('timestamp', { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

      if (selectedPractice) query = query.eq('practice_id', selectedPractice)
      if (actionFilter) query = query.ilike('action', `%${actionFilter}%`)
      if (severityFilter) query = query.eq('severity', severityFilter)

      const { data, count, error } = await query

      if (error) {
        console.error('Audit query error:', error)
        return
      }

      setLogs(data ?? [])
      setTotal(count ?? 0)
    } finally {
      setLoading(false)
    }
  }, [selectedPractice, actionFilter, severityFilter, fromDate, toDate, page])

  useEffect(() => {
    loadLogs()
  }, [loadLogs])

  // CSV export via admin API
  const handleExport = async () => {
    const params = new URLSearchParams()
    if (selectedPractice) params.set('practice_id', selectedPractice)
    params.set('from', `${fromDate}T00:00:00Z`)
    params.set('to', `${toDate}T23:59:59Z`)
    if (actionFilter) params.set('action', actionFilter)
    if (severityFilter) params.set('severity', severityFilter)
    params.set('format', 'csv')
    params.set('limit', '10000')

    // Build CSV client-side from current query since admin API needs CRON_SECRET
    let allLogs: AuditLog[] = []
    let offset = 0
    const batchSize = 1000

    while (true) {
      let query = supabase
        .from('audit_logs')
        .select('*')
        .gte('timestamp', `${fromDate}T00:00:00Z`)
        .lte('timestamp', `${toDate}T23:59:59Z`)
        .order('timestamp', { ascending: false })
        .range(offset, offset + batchSize - 1)

      if (selectedPractice) query = query.eq('practice_id', selectedPractice)
      if (actionFilter) query = query.ilike('action', `%${actionFilter}%`)
      if (severityFilter) query = query.eq('severity', severityFilter)

      const { data } = await query
      if (!data || data.length === 0) break
      allLogs = allLogs.concat(data)
      if (data.length < batchSize) break
      offset += batchSize
    }

    // Build CSV
    const headers = ['timestamp', 'action', 'severity', 'user_email', 'user_id', 'practice_id', 'resource_type', 'resource_id', 'ip_address', 'user_agent', 'details']
    const rows = allLogs.map(log =>
      headers.map(h => {
        const val = (log as any)[h]
        if (val === null || val === undefined) return ''
        const str = h === 'details' ? JSON.stringify(val) : String(val)
        return str.includes(',') || str.includes('"') || str.includes('\n')
          ? `"${str.replace(/"/g, '""')}"`
          : str
      }).join(',')
    )

    const csv = [headers.join(','), ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const practiceName = practices.find(p => p.id === selectedPractice)?.name
    const slug = practiceName ? practiceName.toLowerCase().replace(/[^a-z0-9]+/g, '-') : 'all-practices'
    a.href = url
    a.download = `harbor-audit-${slug}-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Shield className="w-6 h-6 text-teal-600" />
            HIPAA Audit Trail
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Cross-practice audit log &mdash; {total.toLocaleString()} events
          </p>
        </div>
        <button
          onClick={handleExport}
          className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors text-sm font-medium"
        >
          <Download className="w-4 h-4" />
          Export CSV
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Practice</label>
            <select
              value={selectedPractice}
              onChange={e => { setSelectedPractice(e.target.value); setPage(0) }}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent"
            >
              <option value="">All Practices</option>
              {practices.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Action</label>
            <div className="relative">
              <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-gray-400" />
              <input
                type="text"
                value={actionFilter}
                onChange={e => { setActionFilter(e.target.value); setPage(0) }}
                placeholder="login, view_patient..."
                className="w-full border border-gray-300 rounded-lg pl-8 pr-3 py-2 text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Severity</label>
            <select
              value={severityFilter}
              onChange={e => { setSeverityFilter(e.target.value); setPage(0) }}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent"
            >
              <option value="">All</option>
              <option value="info">Info</option>
              <option value="warn">Warning</option>
              <option value="error">Error</option>
              <option value="critical">Critical</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">From</label>
            <input
              type="date"
              value={fromDate}
              onChange={e => { setFromDate(e.target.value); setPage(0) }}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">To</label>
            <input
              type="date"
              value={toDate}
              onChange={e => { setToDate(e.target.value); setPage(0) }}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent"
            />
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Timestamp</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Action</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Severity</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">User</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Practice</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">IP</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-gray-400">Loading...</td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-gray-400">No audit events found</td>
                </tr>
              ) : (
                logs.map(log => {
                  const practice = practices.find(p => p.id === log.practice_id)
                  return (
                    <tr key={log.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                        {new Date(log.timestamp).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">{log.action}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs ${SEVERITY_COLORS[log.severity] || 'bg-gray-100 text-gray-600'}`}>
                          {log.severity}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600 max-w-[180px] truncate">
                        {log.user_email || <span className="text-gray-300">system</span>}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600 max-w-[160px] truncate">
                        {practice?.name || log.practice_id?.slice(0, 8) || <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-400 font-mono">
                        {log.ip_address || '—'}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500 max-w-[200px] truncate">
                        {log.details && Object.keys(log.details).length > 0
                          ? JSON.stringify(log.details).slice(0, 80)
                          : '—'}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 bg-gray-50">
            <p className="text-xs text-gray-500">
              Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total.toLocaleString()}
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                className="p-1.5 rounded-lg border border-gray-300 disabled:opacity-30 hover:bg-gray-100"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-xs text-gray-600">
                Page {page + 1} of {totalPages}
              </span>
              <button
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="p-1.5 rounded-lg border border-gray-300 disabled:opacity-30 hover:bg-gray-100"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
