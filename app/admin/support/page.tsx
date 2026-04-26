'use client'

import { useState, useEffect, useCallback } from 'react'

interface Ticket {
  id: string
  practice_id: string
  user_id: string | null
  subject: string
  description: string
  category: string
  priority: string
  status: string
  page_url: string | null
  browser_info: string | null
  assigned_to: string | null
  dev_notes: string | null
  resolution: string | null
  created_at: string
  updated_at: string
  resolved_at: string | null
  practice_name?: string
}

const STATUS_OPTIONS = [
  { value: 'open', label: 'Open', bg: '#fef3c7', text: '#92400e' },
  { value: 'in_progress', label: 'In Progress', bg: '#dbeafe', text: '#1e40af' },
  { value: 'waiting', label: 'Waiting', bg: '#e0e7ff', text: '#4338ca' },
  { value: 'resolved', label: 'Resolved', bg: '#d1fae5', text: '#065f46' },
  { value: 'closed', label: 'Closed', bg: '#f3f4f6', text: '#6b7280' },
]

const PRIORITY_OPTIONS = [
  { value: 'low', label: 'Low', color: '#6b7280' },
  { value: 'medium', label: 'Medium', color: '#f59e0b' },
  { value: 'high', label: 'High', color: '#ef4444' },
  { value: 'critical', label: 'Critical', color: '#dc2626' },
]

const CATEGORY_LABELS: Record<string, string> = {
  voice_calls: 'Phone Calls',
  intake: 'Intake Forms',
  scheduling: 'Scheduling',
  billing: 'Billing',
  dashboard: 'Dashboard',
  sms: 'Text Messages',
  other: 'Other',
}

export default function AdminSupportPage() {
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('open')
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null)
  const [devNotes, setDevNotes] = useState('')
  const [resolution, setResolution] = useState('')
  const [saving, setSaving] = useState(false)

  const fetchTickets = useCallback(async () => {
    try {
      // Admin fetches all tickets across practices via dedicated admin endpoint
      const params = new URLSearchParams()
      if (statusFilter !== 'all') params.set('status', statusFilter)
      params.set('admin', '1')
      const res = await fetch(`/api/admin/support?${params.toString()}`)
      if (res.ok) {
        const data = await res.json()
        setTickets(data.tickets || [])
      }
    } catch (err) {
      console.error('Failed to fetch tickets:', err)
    } finally {
      setLoading(false)
    }
  }, [statusFilter])

  useEffect(() => {
    fetchTickets()
  }, [fetchTickets])

  // Auto-refresh every 30 seconds for admin
  useEffect(() => {
    const interval = setInterval(fetchTickets, 30000)
    return () => clearInterval(interval)
  }, [fetchTickets])

  const openTicket = (t: Ticket) => {
    setSelectedTicket(t)
    setDevNotes(t.dev_notes || '')
    setResolution(t.resolution || '')
  }

  const updateTicket = async (ticketId: string, updates: Record<string, any>) => {
    setSaving(true)
    try {
      const res = await fetch(`/api/support/${ticketId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      if (res.ok) {
        fetchTickets()
        if (selectedTicket?.id === ticketId) {
          const data = await res.json()
          setSelectedTicket(data.ticket)
        }
      }
    } catch (err) {
      console.error('Failed to update ticket:', err)
    } finally {
      setSaving(false)
    }
  }

  const formatDate = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  }

  const getStatusInfo = (s: string) => STATUS_OPTIONS.find((o) => o.value === s) || STATUS_OPTIONS[0]
  const getPriorityInfo = (p: string) => PRIORITY_OPTIONS.find((o) => o.value === p) || PRIORITY_OPTIONS[1]

  const openCount = tickets.filter((t) => t.status === 'open').length
  const criticalCount = tickets.filter((t) => t.priority === 'critical' && t.status !== 'resolved' && t.status !== 'closed').length

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1f2937', margin: 0 }}>Support Tickets</h1>
        <p style={{ color: '#6b7280', fontSize: 14, marginTop: 4 }}>
          Track and resolve issues reported by practices
        </p>
      </div>

      {/* Stats */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
        <div style={{ background: '#fef3c7', borderRadius: 10, padding: '12px 20px', minWidth: 120 }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: '#92400e' }}>{openCount}</div>
          <div style={{ fontSize: 12, color: '#92400e' }}>Open</div>
        </div>
        {criticalCount > 0 && (
          <div style={{ background: '#fee2e2', borderRadius: 10, padding: '12px 20px', minWidth: 120 }}>
            <div style={{ fontSize: 24, fontWeight: 700, color: '#dc2626' }}>{criticalCount}</div>
            <div style={{ fontSize: 12, color: '#dc2626' }}>Critical</div>
          </div>
        )}
        <div style={{ background: '#f0fdfa', borderRadius: 10, padding: '12px 20px', minWidth: 120 }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: '#0d9488' }}>{tickets.length}</div>
          <div style={{ fontSize: 12, color: '#0d9488' }}>Total Shown</div>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {['all', 'open', 'in_progress', 'waiting', 'resolved', 'closed'].map((s) => {
          const info = STATUS_OPTIONS.find((o) => o.value === s)
          return (
            <button
              key={s}
              onClick={() => { setStatusFilter(s); setLoading(true) }}
              style={{
                padding: '5px 12px',
                borderRadius: 16,
                border: statusFilter === s ? '2px solid #334155' : '1px solid #cbd5e1',
                background: statusFilter === s ? '#334155' : 'white',
                color: statusFilter === s ? 'white' : '#64748b',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {s === 'all' ? 'All' : info?.label || s}
            </button>
          )
        })}
      </div>

      {/* Two-column: list + detail */}
      <div style={{ display: 'flex', gap: 16, minHeight: 500 }}>
        {/* Ticket list */}
        <div style={{ flex: 1, maxWidth: selectedTicket ? '50%' : '100%' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 40, color: '#9ca3af' }}>Loading...</div>
          ) : tickets.length === 0 ? (
            <div style={{ background: 'white', borderRadius: 10, padding: 40, textAlign: 'center', border: '1px solid #e2e8f0' }}>
              <p style={{ color: '#94a3b8' }}>No tickets match this filter.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {tickets.map((t) => {
                const si = getStatusInfo(t.status)
                const pi = getPriorityInfo(t.priority)
                const isSelected = selectedTicket?.id === t.id

                return (
                  <div
                    key={t.id}
                    onClick={() => openTicket(t)}
                    style={{
                      background: isSelected ? '#f8fafc' : 'white',
                      borderRadius: 8,
                      padding: '12px 16px',
                      border: isSelected ? '2px solid #334155' : '1px solid #e2e8f0',
                      cursor: 'pointer',
                      transition: 'border-color 0.15s',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <span style={{ fontWeight: 600, fontSize: 14, color: '#1e293b' }}>{t.subject}</span>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          padding: '2px 8px',
                          borderRadius: 10,
                          background: si.bg,
                          color: si.text,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {si.label}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: 10, fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
                      <span style={{ color: pi.color, fontWeight: 600 }}>{pi.label}</span>
                      <span>{CATEGORY_LABELS[t.category] || t.category}</span>
                      <span>{t.practice_name || t.practice_id.slice(0, 8)}</span>
                      <span>{formatDate(t.created_at)}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Detail panel */}
        {selectedTicket && (
          <div
            style={{
              flex: 1,
              maxWidth: '50%',
              background: 'white',
              borderRadius: 10,
              border: '1px solid #e2e8f0',
              padding: 20,
              position: 'sticky',
              top: 20,
              maxHeight: 'calc(100vh - 160px)',
              overflowY: 'auto',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: '#1e293b', margin: 0 }}>{selectedTicket.subject}</h2>
              <button
                onClick={() => setSelectedTicket(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 18 }}
              >
                x
              </button>
            </div>

            {/* Meta row */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
              <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 10, background: getStatusInfo(selectedTicket.status).bg, color: getStatusInfo(selectedTicket.status).text }}>
                {getStatusInfo(selectedTicket.status).label}
              </span>
              <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 10, background: '#f1f5f9', color: getPriorityInfo(selectedTicket.priority).color }}>
                {getPriorityInfo(selectedTicket.priority).label}
              </span>
              <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 10, background: '#f1f5f9', color: '#475569' }}>
                {CATEGORY_LABELS[selectedTicket.category] || selectedTicket.category}
              </span>
            </div>

            <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 12 }}>
              Practice: {selectedTicket.practice_name || selectedTicket.practice_id.slice(0, 8)} &middot; {formatDate(selectedTicket.created_at)}
            </div>

            {/* Description */}
            <div style={{ background: '#f8fafc', borderRadius: 8, padding: 14, marginBottom: 16 }}>
              <p style={{ fontSize: 14, color: '#334155', lineHeight: 1.6, margin: 0, whiteSpace: 'pre-wrap' }}>
                {selectedTicket.description}
              </p>
            </div>

            {selectedTicket.page_url && (
              <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>
                <strong>Page:</strong> {selectedTicket.page_url}
              </div>
            )}
            {selectedTicket.browser_info && (
              <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 16, wordBreak: 'break-all' }}>
                <strong>Browser:</strong> {selectedTicket.browser_info}
              </div>
            )}

            {/* Status change */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 4 }}>
                Update Status
              </label>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {STATUS_OPTIONS.map((s) => (
                  <button
                    key={s.value}
                    onClick={() => updateTicket(selectedTicket.id, { status: s.value })}
                    disabled={saving || selectedTicket.status === s.value}
                    style={{
                      padding: '4px 10px',
                      borderRadius: 6,
                      border: selectedTicket.status === s.value ? '2px solid #334155' : '1px solid #cbd5e1',
                      background: selectedTicket.status === s.value ? s.bg : 'white',
                      color: selectedTicket.status === s.value ? s.text : '#64748b',
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: selectedTicket.status === s.value ? 'default' : 'pointer',
                      opacity: saving ? 0.5 : 1,
                    }}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Dev notes */}
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 4 }}>
                Dev Notes (internal)
              </label>
              <textarea
                value={devNotes}
                onChange={(e) => setDevNotes(e.target.value)}
                rows={3}
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  border: '1px solid #cbd5e1',
                  borderRadius: 6,
                  fontSize: 13,
                  resize: 'vertical',
                  boxSizing: 'border-box',
                  fontFamily: 'inherit',
                }}
              />
            </div>

            {/* Resolution */}
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 4 }}>
                Resolution (visible to practice)
              </label>
              <textarea
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
                rows={2}
                placeholder="What was done to fix the issue?"
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  border: '1px solid #cbd5e1',
                  borderRadius: 6,
                  fontSize: 13,
                  resize: 'vertical',
                  boxSizing: 'border-box',
                  fontFamily: 'inherit',
                }}
              />
            </div>

            <button
              onClick={() => updateTicket(selectedTicket.id, { dev_notes: devNotes, resolution })}
              disabled={saving}
              style={{
                background: saving ? '#94a3b8' : '#334155',
                color: 'white',
                border: 'none',
                borderRadius: 6,
                padding: '8px 16px',
                fontSize: 13,
                fontWeight: 600,
                cursor: saving ? 'not-allowed' : 'pointer',
              }}
            >
              {saving ? 'Saving...' : 'Save Notes'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
