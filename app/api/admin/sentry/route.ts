// Sentry proxy API — fetches error + uptime data from Sentry for admin dashboard
// GET /api/admin/sentry
// Requires admin role via Supabase auth

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

const SENTRY_ORG = process.env.SENTRY_ORG || 'harbor-receptionist'
const SENTRY_PROJECT = process.env.SENTRY_PROJECT || 'harbor-app'
const SENTRY_AUTH_TOKEN = process.env.SENTRY_AUTH_TOKEN

async function sentryFetch(path: string) {
  if (!SENTRY_AUTH_TOKEN) return null
  try {
    const res = await fetch(`https://sentry.io/api/0/${path}`, {
      headers: {
        Authorization: `Bearer ${SENTRY_AUTH_TOKEN}`,
        'Content-Type': 'application/json',
      },
      next: { revalidate: 60 }, // cache 1 min
    })
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}

export async function GET(req: NextRequest) {
  // Auth check — admin only
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

  // Fetch Sentry data in parallel
  const [issues, uptimeAlerts] = await Promise.all([
    // Recent unresolved issues (top 10)
    sentryFetch(
      `projects/${SENTRY_ORG}/${SENTRY_PROJECT}/issues/?query=is:unresolved&sort=date&limit=10`
    ),
    // Uptime alerts
    sentryFetch(
      `organizations/${SENTRY_ORG}/alert-rules/?project=${SENTRY_PROJECT}`
    ),
  ])

  // Parse uptime monitor data from alert rules
  const uptimeMonitors = (uptimeAlerts || [])
    .filter((a: any) => a.monitorType === 'uptime' || a.type === 'uptime')
    .map((a: any) => ({
      id: a.id,
      name: a.name,
      url: a.config?.url || a.uptimeUrl,
      status: a.status,
    }))

  // Summarize issues by level
  const errorSummary = {
    total: issues?.length || 0,
    byLevel: {
      error: (issues || []).filter((i: any) => i.level === 'error').length,
      warning: (issues || []).filter((i: any) => i.level === 'warning').length,
      info: (issues || []).filter((i: any) => i.level === 'info').length,
    },
    recent: (issues || []).slice(0, 5).map((i: any) => ({
      id: i.id,
      title: i.title,
      culprit: i.culprit,
      level: i.level,
      count: i.count,
      firstSeen: i.firstSeen,
      lastSeen: i.lastSeen,
      permalink: i.permalink,
    })),
  }

  return NextResponse.json({
    configured: !!SENTRY_AUTH_TOKEN,
    errors: errorSummary,
    uptime: uptimeMonitors,
    sentryUrl: `https://${SENTRY_ORG}.sentry.io`,
    fetched_at: new Date().toISOString(),
  })
}
