// app/api/admin/roi-leads/route.ts
// Admin-only: list ROI calculator submissions as leads, with the summary stats
// the admin dashboard shows across the top.
// GET /api/admin/roi-leads?stage=new&source=instantly&days=30

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireApiSession } from '@/lib/aws/api-auth'

const STAGES = ['new', 'contacted', 'demo_booked', 'proposal_sent', 'won', 'lost', 'unresponsive'] as const

async function requireAdmin() {
  const supabase = await createClient()
  const __ctx = await requireApiSession();
  if (__ctx instanceof NextResponse) return __ctx;
  const user = { id: __ctx.user.id, email: __ctx.session.email };
  if (!user) return { user: null, error: 'Unauthorized' as const, status: 401 }
  const adminEmail = process.env.ADMIN_EMAIL
  if (!adminEmail || user.email !== adminEmail) {
    return { user: null, error: 'Forbidden — admin only' as const, status: 403 }
  }
  return { user, error: null, status: 200 }
}

export async function GET(req: NextRequest) {
  const auth = await requireAdmin()
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { searchParams } = new URL(req.url)
  const stage = searchParams.get('stage') || 'all'
  const source = searchParams.get('source')
  const days = parseInt(searchParams.get('days') || '90', 10)

  let query = supabaseAdmin
    .from('roi_calculator_submissions')
    .select('*')
    .order('stage', { ascending: true })
    .order('next_action_at', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(500)

  if (STAGES.includes(stage as any)) {
    query = query.eq('stage', stage)
  }
  if (source) {
    query = query.eq('utm_source', source)
  }
  if (days > 0) {
    const since = new Date(Date.now() - days * 86_400_000).toISOString()
    query = query.gte('created_at', since)
  }

  const { data: leads, error } = await query
  if (error) {
    console.error('[admin/roi-leads]', error)
    return NextResponse.json({ error: 'Failed to load leads' }, { status: 500 })
  }

  // Summary stats across the full (non-filtered) pipeline
  const { data: allLeads } = await supabaseAdmin
    .from('roi_calculator_submissions')
    .select('stage, annual_total_loss_cents, created_at, contacted_at')

  const now = Date.now()
  const weekAgo = now - 7 * 86_400_000
  const stageCounts: Record<string, number> = {}
  let pipelineCents = 0
  let demosThisWeek = 0
  let wonThisWeek = 0
  let totalClosed = 0
  let totalWon = 0
  for (const l of allLeads || []) {
    stageCounts[l.stage] = (stageCounts[l.stage] || 0) + 1
    if (l.stage === 'demo_booked' || l.stage === 'proposal_sent' || l.stage === 'contacted' || l.stage === 'new') {
      pipelineCents += Number(l.annual_total_loss_cents || 0)
    }
    const created = new Date(l.created_at).getTime()
    if (l.stage === 'demo_booked' && created >= weekAgo) demosThisWeek++
    if (l.stage === 'won' && created >= weekAgo) wonThisWeek++
    if (l.stage === 'won' || l.stage === 'lost') totalClosed++
    if (l.stage === 'won') totalWon++
  }
  const winRatePct = totalClosed > 0 ? Math.round((totalWon / totalClosed) * 100) : null

  // Sources breakdown for the filter dropdown
  const sources = Array.from(
    new Set((allLeads || []).map((l: any) => l.utm_source).filter(Boolean))
  )

  return NextResponse.json({
    leads: leads || [],
    summary: {
      stage_counts: stageCounts,
      pipeline_annual_loss_cents: pipelineCents,
      demos_this_week: demosThisWeek,
      won_this_week: wonThisWeek,
      win_rate_pct: winRatePct,
      total_leads: (allLeads || []).length,
    },
    sources,
  })
}
