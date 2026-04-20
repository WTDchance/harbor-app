/**
 * POST /api/cancellation/dispatch
 *
 * Entry point for the cancellation-fill dispatcher (Phase 2, observational).
 *
 * CALLERS:
 *  - The cancel-appointment flow invokes this after marking an appointment
 *    cancelled (not-yet-wired in Phase 2; caller must hit this endpoint
 *    manually or the dashboard cancel button can fire-and-forget POST it).
 *
 * BEHAVIOR:
 *  - Loads the appointment, verifies status='cancelled' or 'cancelled_late'.
 *  - Computes the bucket from lead time vs. scheduled_at.
 *  - Enforces practice-level hard blocks (dispatcher_enabled, crisis lookback).
 *  - Builds a candidate pool and filters per ethics gates.
 *  - Writes audit rows into cancellation_fill_offers (status='observed').
 *  - DOES NOT SEND SMS OR EMAIL. Phase 3 wires real outreach.
 *
 * AUTH:
 *  - Protected by Bearer CRON_SECRET (same pattern as /api/admin/*).
 *    Internal callers (server-side, same-process) can pass the secret from
 *    process.env.CRON_SECRET or use dispatchByAppointmentId() directly.
 *
 * Returns:
 *  200 { ok: true, decision: DispatchDecision }
 *  400 on bad input
 *  401 on bad auth
 *  404 on missing appointment
 */

import { NextRequest, NextResponse } from 'next/server'
import { dispatchByAppointmentId } from '@/lib/cancellation-fill/dispatcher'

export const dynamic = 'force-dynamic'

function checkAuth(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const auth = req.headers.get('authorization') ?? ''
  return auth === `Bearer ${secret}`
}

export async function POST(request: NextRequest) {
  if (!checkAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { appointment_id?: string } = {}
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const appointmentId = body.appointment_id
  if (!appointmentId || typeof appointmentId !== 'string') {
    return NextResponse.json(
      { error: 'appointment_id (string) required in body' },
      { status: 400 }
    )
  }

  const result = await dispatchByAppointmentId(appointmentId)
  if ('error' in result) {
    const status = result.error.includes('not found') ? 404 : 400
    return NextResponse.json({ error: result.error }, { status })
  }

  return NextResponse.json({ ok: true, decision: result })
}

export async function GET(request: NextRequest) {
  // Convenience for manual testing — accepts ?appointment_id=...
  if (!checkAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const appointmentId = request.nextUrl.searchParams.get('appointment_id')
  if (!appointmentId) {
    return NextResponse.json(
      { error: 'appointment_id query param required' },
      { status: 400 }
    )
  }
  const result = await dispatchByAppointmentId(appointmentId)
  if ('error' in result) {
    const status = result.error.includes('not found') ? 404 : 400
    return NextResponse.json({ error: result.error }, { status })
  }
  return NextResponse.json({ ok: true, decision: result })
}
