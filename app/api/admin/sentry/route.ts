// Sentry proxy — pulls error + uptime data for the admin dashboard.
// Auth: requireAdminSession (Cognito).

import { NextResponse } from 'next/server'
import { requireAdminSession } from '@/lib/aws/api-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SENTRY_ORG = process.env.SENTRY_ORG || 'harbor-receptionist'
const SENTRY_PROJECT = process.env.SENTRY_PROJECT || 'harbor-app'
const SENTRY_AUTH_TOKEN = process.env.SENTRY_AUTH_TOKEN

async function sentryFetch(path: string): Promise<any> {
  if (!SENTRY_AUTH_TOKEN) return null
  try {
    const res = await fetch(`https://sentry.io/api/0/${path}`, {
      headers: {
        Authorization: `Bearer ${SENTRY_AUTH_TOKEN}`,
        'Content-Type': 'application/json',
      },
      next: { revalidate: 60 }, // 1 min CDN cache
    })
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}

export async function GET() {
  const ctx = await requireAdminSession()
  if (ctx instanceof NextResponse) return ctx

  const [issues, uptimeAlerts] = await Promise.all([
    sentryFetch(`projects/${SENTRY_ORG}/${SENTRY_PROJECT}/issues/?query=is:unresolved&sort=date&limit=10`),
    sentryFetch(`organizations/${SENTRY_ORG}/alert-rules/?project=${SENTRY_PROJECT}`),
  ])

  const uptimeMonitors = (uptimeAlerts || [])
    .filter((a: any) => a.monitorType === 'uptime' || a.type === 'uptime')
    .map((a: any) => ({
      id: a.id,
      name: a.name,
      url: a.config?.url || a.uptimeUrl,
      status: a.status,
    }))

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
