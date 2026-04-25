// Admin — ROI calculator submissions as leads, plus pipeline summary stats.
// Filters: ?stage=<one-of>, ?source=<utm_source>, ?days=<lookback window>.

import { NextResponse, type NextRequest } from 'next/server'
import { requireAdminSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const STAGES = [
  'new', 'contacted', 'demo_booked', 'proposal_sent', 'won', 'lost', 'unresponsive',
] as const
type Stage = typeof STAGES[number]

export async function GET(req: NextRequest) {
  const ctx = await requireAdminSession()
  if (ctx instanceof NextResponse) return ctx

  const sp = req.nextUrl.searchParams
  const stage = sp.get('stage') || 'all'
  const source = sp.get('source')
  const days = Math.max(Number(sp.get('days') ?? 90), 0)

  // Filtered list with the same ordering as the legacy route.
  const conds: string[] = []
  const args: unknown[] = []
  if ((STAGES as readonly string[]).includes(stage)) {
    args.push(stage)
    conds.push(`stage = $${args.length}`)
  }
  if (source) {
    args.push(source)
    conds.push(`utm_source = $${args.length}`)
  }
  if (days > 0) {
    const since = new Date(Date.now() - days * 86_400_000).toISOString()
    args.push(since)
    conds.push(`created_at >= $${args.length}`)
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''

  let leads: any[] = []
  let allLeads: any[] = []
  try {
    const leadsResult = await pool.query(
      `SELECT *
         FROM roi_calculator_submissions
         ${where}
        ORDER BY stage ASC,
                 next_action_at ASC NULLS LAST,
                 created_at DESC
        LIMIT 500`,
      args,
    )
    leads = leadsResult.rows

    // Summary stats run across the full (non-filtered) pipeline.
    const allResult = await pool.query(
      `SELECT stage, annual_total_loss_cents, created_at, contacted_at
         FROM roi_calculator_submissions`,
    )
    allLeads = allResult.rows
  } catch {
    // Table may not exist on this RDS — return empty rather than 500.
    return NextResponse.json({
      leads: [],
      summary: {
        stage_counts: {},
        pipeline_annual_loss_cents: 0,
        demos_this_week: 0,
        won_this_week: 0,
        win_rate_pct: null,
        total_leads: 0,
      },
      sources: [],
    })
  }

  const now = Date.now()
  const weekAgo = now - 7 * 86_400_000
  const stageCounts: Record<string, number> = {}
  let pipelineCents = 0
  let demosThisWeek = 0
  let wonThisWeek = 0
  let totalClosed = 0
  let totalWon = 0
  for (const l of allLeads) {
    stageCounts[l.stage] = (stageCounts[l.stage] || 0) + 1
    if (
      l.stage === 'demo_booked' || l.stage === 'proposal_sent' ||
      l.stage === 'contacted'   || l.stage === 'new'
    ) {
      pipelineCents += Number(l.annual_total_loss_cents || 0)
    }
    const created = new Date(l.created_at).getTime()
    if (l.stage === 'demo_booked' && created >= weekAgo) demosThisWeek++
    if (l.stage === 'won' && created >= weekAgo) wonThisWeek++
    if (l.stage === 'won' || l.stage === 'lost') totalClosed++
    if (l.stage === 'won') totalWon++
  }
  const winRatePct =
    totalClosed > 0 ? Math.round((totalWon / totalClosed) * 100) : null

  const sources = Array.from(
    new Set(allLeads.map(l => l.utm_source).filter(Boolean)),
  )

  return NextResponse.json({
    leads,
    summary: {
      stage_counts: stageCounts,
      pipeline_annual_loss_cents: pipelineCents,
      demos_this_week: demosThisWeek,
      won_this_week: wonThisWeek,
      win_rate_pct: winRatePct,
      total_leads: allLeads.length,
    },
    sources,
  })
}
