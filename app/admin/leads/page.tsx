'use client'

// app/admin/leads/page.tsx
// Harbor — Sales lead pipeline admin view.
// Lists every ROI-calculator submission, groups by stage, lets the founder
// update stage/notes/next-action inline without leaving the page.

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'

type Stage = 'new' | 'contacted' | 'demo_booked' | 'proposal_sent' | 'won' | 'lost' | 'unresponsive'

interface Lead {
  id: string
  email: string | null
  first_name: string | null
  last_name: string | null
  practice_name: string | null
  phone: string | null

  session_rate_cents: number
  missed_calls_per_week: number
  missed_appointments_per_week: number
  insurance_hours_per_week: number
  annual_total_loss_cents: number

  stage: Stage
  notes: string | null
  next_action_at: string | null
  contacted_at: string | null
  contacted_by: string | null
  converted_practice_id: string | null

  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  referrer_url: string | null

  created_at: string
}

interface Summary {
  stage_counts: Record<string, number>
  pipeline_annual_loss_cents: number
  demos_this_week: number
  won_this_week: number
  win_rate_pct: number | null
  total_leads: number
}

interface ApiResponse {
  leads: Lead[]
  summary: Summary
  sources: string[]
}

const STAGE_LABELS: Record<Stage, string> = {
  new: 'New',
  contacted: 'Contacted',
  demo_booked: 'Demo Booked',
  proposal_sent: 'Proposal Sent',
  won: 'Won',
  lost: 'Lost',
  unresponsive: 'Unresponsive',
}

const STAGE_STYLES: Record<Stage, string> = {
  new: 'bg-blue-50 text-blue-700 border-blue-200',
  contacted: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  demo_booked: 'bg-purple-50 text-purple-700 border-purple-200',
  proposal_sent: 'bg-amber-50 text-amber-800 border-amber-200',
  won: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  lost: 'bg-gray-100 text-gray-600 border-gray-200',
  unresponsive: 'bg-gray-50 text-gray-500 border-gray-200',
}

const fmtUSD = (cents: number) =>
  `$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`

const fmtDate = (iso: string | null) => {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function AdminLeadsPage() {
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filterStage, setFilterStage] = useState<string>('all')
  const [filterSource, setFilterSource] = useState<string>('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const load = async () => {
    try {
      const params = new URLSearchParams()
      if (filterStage !== 'all') params.set('stage', filterStage)
      if (filterSource) params.set('source', filterSource)
      const res = await fetch(`/api/admin/roi-leads?${params}`, { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error || 'Failed to load')
        setData(null)
      } else {
        setData(json)
        setError(null)
      }
    } catch (e: any) {
      setError(e?.message || 'Network error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setLoading(true)
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterStage, filterSource])

  // Group leads: "Action today" first (next_action_at overdue or today),
  // then grouped by stage.
  const grouped = useMemo(() => {
    if (!data?.leads) return { today: [], byStage: {} as Record<Stage, Lead[]> }
    const now = Date.now()
    const endOfToday = new Date()
    endOfToday.setHours(23, 59, 59, 999)
    const today: Lead[] = []
    const byStage: Record<string, Lead[]> = {}
    for (const l of data.leads) {
      const naDue = l.next_action_at && new Date(l.next_action_at).getTime() <= endOfToday.getTime()
      if (naDue && l.stage !== 'won' && l.stage !== 'lost') {
        today.push(l)
      }
      byStage[l.stage] = byStage[l.stage] || []
      byStage[l.stage].push(l)
    }
    return { today, byStage: byStage as Record<Stage, Lead[]> }
  }, [data])

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Leads pipeline</h1>
            <p className="text-sm text-gray-500 mt-1">Every ROI-calculator submission, worked like a funnel.</p>
          </div>
          <Link href="/admin" className="text-sm text-teal-700 hover:text-teal-900">&larr; Admin home</Link>
        </div>

        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div>
        )}

        {/* Summary scorecard */}
        {data?.summary && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
            <Stat label="Total leads" value={data.summary.total_leads.toString()} />
            <Stat label="Demos booked (7d)" value={data.summary.demos_this_week.toString()} />
            <Stat label="Won (7d)" value={data.summary.won_this_week.toString()} />
            <Stat
              label="Win rate"
              value={data.summary.win_rate_pct === null ? '—' : `${data.summary.win_rate_pct}%`}
            />
            <Stat label="Pipeline value/yr" value={fmtUSD(data.summary.pipeline_annual_loss_cents)} />
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <label className="text-sm text-gray-600">Stage:</label>
          <select
            value={filterStage}
            onChange={e => setFilterStage(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
          >
            <option value="all">All</option>
            {(Object.keys(STAGE_LABELS) as Stage[]).map(s => (
              <option key={s} value={s}>
                {STAGE_LABELS[s]} {data?.summary?.stage_counts?.[s] ? `(${data.summary.stage_counts[s]})` : ''}
              </option>
            ))}
          </select>

          <label className="text-sm text-gray-600 ml-4">Source:</label>
          <select
            value={filterSource}
            onChange={e => setFilterSource(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
          >
            <option value="">All sources</option>
            {(data?.sources || []).map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>

          <button
            onClick={load}
            className="ml-auto px-3 py-1.5 text-sm text-teal-700 hover:text-teal-900"
          >
            Refresh
          </button>
        </div>

        {loading && !data && (
          <div className="text-center py-16 text-gray-400">Loading leads…</div>
        )}

        {data && data.leads.length === 0 && (
          <div className="bg-white border border-gray-200 rounded-xl p-10 text-center text-gray-500">
            No leads yet matching these filters. As therapists fill out the ROI calculator at /roi, they&apos;ll show up here.
          </div>
        )}

        {/* Action-today surface — only show when viewing 'all' */}
        {data && filterStage === 'all' && grouped.today.length > 0 && (
          <section className="mb-6">
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">
              Action today ({grouped.today.length})
            </h2>
            <div className="space-y-2">
              {grouped.today.map(lead => (
                <LeadRow
                  key={lead.id}
                  lead={lead}
                  expanded={expandedId === lead.id}
                  onToggle={() => setExpandedId(expandedId === lead.id ? null : lead.id)}
                  onUpdated={load}
                />
              ))}
            </div>
          </section>
        )}

        {/* Grouped by stage (when filter is 'all') or flat list (when filtered) */}
        {data && filterStage !== 'all' ? (
          <div className="space-y-2">
            {data.leads.map(lead => (
              <LeadRow
                key={lead.id}
                lead={lead}
                expanded={expandedId === lead.id}
                onToggle={() => setExpandedId(expandedId === lead.id ? null : lead.id)}
                onUpdated={load}
              />
            ))}
          </div>
        ) : data ? (
          <>
            {(Object.keys(STAGE_LABELS) as Stage[]).map(stage => {
              const leads = grouped.byStage[stage] || []
              if (leads.length === 0) return null
              return (
                <section key={stage} className="mb-6">
                  <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">
                    {STAGE_LABELS[stage]} ({leads.length})
                  </h2>
                  <div className="space-y-2">
                    {leads.map(lead => (
                      <LeadRow
                        key={lead.id}
                        lead={lead}
                        expanded={expandedId === lead.id}
                        onToggle={() => setExpandedId(expandedId === lead.id ? null : lead.id)}
                        onUpdated={load}
                      />
                    ))}
                  </div>
                </section>
              )
            })}
          </>
        ) : null}
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <p className="text-xs text-gray-500 uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
    </div>
  )
}

function LeadRow({
  lead,
  expanded,
  onToggle,
  onUpdated,
}: {
  lead: Lead
  expanded: boolean
  onToggle: () => void
  onUpdated: () => void
}) {
  const name = [lead.first_name, lead.last_name].filter(Boolean).join(' ') || '(no name)'
  const sourceLabel = lead.utm_source
    ? `${lead.utm_source}${lead.utm_campaign ? ` / ${lead.utm_campaign}` : ''}`
    : 'direct'

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full text-left p-4 hover:bg-gray-50 transition-colors flex items-center gap-3"
      >
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${STAGE_STYLES[lead.stage]}`}
        >
          {STAGE_LABELS[lead.stage]}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold text-gray-900 truncate">{name}</span>
            {lead.practice_name && <span className="text-xs text-gray-500 truncate">· {lead.practice_name}</span>}
          </div>
          <div className="text-xs text-gray-500 mt-0.5 truncate">
            {lead.email || '(no email)'} · {lead.phone || 'no phone'} · {sourceLabel}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-sm font-semibold text-red-600">{fmtUSD(lead.annual_total_loss_cents)}/yr</div>
          <div className="text-xs text-gray-400">Submitted {fmtDate(lead.created_at)}</div>
        </div>
      </button>

      {expanded && <LeadDetail lead={lead} onUpdated={onUpdated} />}
    </div>
  )
}

function LeadDetail({ lead, onUpdated }: { lead: Lead; onUpdated: () => void }) {
  const [stage, setStage] = useState<Stage>(lead.stage)
  const [notes, setNotes] = useState(lead.notes || '')
  const [nextAction, setNextAction] = useState(
    lead.next_action_at ? lead.next_action_at.substring(0, 16) : ''
  )
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/roi-leads/${lead.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stage,
          notes,
          next_action_at: nextAction ? new Date(nextAction).toISOString() : null,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error || 'Save failed')
        return
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      onUpdated()
    } catch (e: any) {
      setError(e?.message || 'Network error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="border-t border-gray-100 p-5 bg-gray-50 space-y-4">
      {/* Practice numbers */}
      <div>
        <h4 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">Their numbers</h4>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <Metric label="Session rate" value={fmtUSD(lead.session_rate_cents)} />
          <Metric label="Missed calls/wk" value={lead.missed_calls_per_week.toString()} />
          <Metric label="Missed appts/wk" value={lead.missed_appointments_per_week.toString()} />
          <Metric label="Insurance hrs/wk" value={lead.insurance_hours_per_week.toString()} />
        </div>
      </div>

      {/* Contact + attribution */}
      <div className="grid md:grid-cols-2 gap-3 text-sm">
        <div>
          <h4 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">Contact</h4>
          <div className="text-gray-700">
            {lead.email && <div>📧 <a href={`mailto:${lead.email}`} className="text-teal-700 hover:underline">{lead.email}</a></div>}
            {lead.phone && <div>📞 <a href={`tel:${lead.phone}`} className="text-teal-700 hover:underline">{lead.phone}</a></div>}
            {lead.contacted_at && <div className="text-xs text-gray-500 mt-1">First contacted {fmtDate(lead.contacted_at)}{lead.contacted_by ? ` by ${lead.contacted_by}` : ''}</div>}
          </div>
        </div>
        <div>
          <h4 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">Attribution</h4>
          <div className="text-gray-700 text-xs">
            <div>Source: {lead.utm_source || '—'}{lead.utm_medium ? ` / ${lead.utm_medium}` : ''}</div>
            <div>Campaign: {lead.utm_campaign || '—'}</div>
            {lead.referrer_url && <div className="truncate">Referrer: {lead.referrer_url}</div>}
          </div>
        </div>
      </div>

      {/* Editable pipeline state */}
      <div className="grid md:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Stage</label>
          <select
            value={stage}
            onChange={e => setStage(e.target.value as Stage)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
          >
            {(Object.keys(STAGE_LABELS) as Stage[]).map(s => (
              <option key={s} value={s}>{STAGE_LABELS[s]}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Next action</label>
          <input
            type="datetime-local"
            value={nextAction}
            onChange={e => setNextAction(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Notes</label>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={4}
          placeholder="What did you talk about? What's next?"
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none"
        />
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}

      <div className="flex items-center justify-end gap-2">
        <button
          onClick={save}
          disabled={saving}
          className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium rounded-lg disabled:opacity-60 transition-colors"
        >
          {saving ? 'Saving…' : saved ? '\u2713 Saved' : 'Save changes'}
        </button>
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg px-3 py-2">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-sm font-semibold text-gray-900">{value}</div>
    </div>
  )
}
