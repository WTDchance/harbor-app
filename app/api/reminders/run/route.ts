// Trigger appointment reminders
// POST /api/reminders/run?type=24hr or ?type=48hr
// Called by a cron job (Railway cron, Vercel cron, or external scheduler)

import { NextRequest, NextResponse } from 'next/server'
import { send24HourReminders, send48HourReminders } from '@/lib/reminders'

// Simple auth check — set CRON_SECRET env var
function isAuthorized(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return true // No secret set — allow (configure in production)

  const authHeader = request.headers.get('authorization')
  return authHeader === `Bearer ${cronSecret}`
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const type = request.nextUrl.searchParams.get('type') || '24hr'

  try {
    let result: { sent: number; errors: number }

    if (type === '48hr') {
      result = await send48HourReminders()
    } else {
      result = await send24HourReminders()
    }

    console.log(`✓ ${type} reminders: ${result.sent} sent, ${result.errors} errors`)

    return NextResponse.json({
      success: true,
      type,
      ...result,
    })
  } catch (error) {
    console.error('Error running reminders:', error)
    return NextResponse.json({ error: 'Failed to run reminders' }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  return NextResponse.json({
    message: 'Reminders endpoint',
    usage: 'POST /api/reminders/run?type=24hr or ?type=48hr',
  })
}
