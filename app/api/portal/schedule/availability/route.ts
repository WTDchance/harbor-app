// app/api/portal/schedule/availability/route.ts
//
// Wave 42 / T1 — compute available slots for a portal-authenticated
// patient. Returns up to advance_window_days of free slots starting
// at lead_time_minutes from now, in slot_duration increments,
// excluding existing appointments + buffer.

import { NextResponse, type NextRequest } from 'next/server'
import { requirePortalSession } from '@/lib/aws/portal-auth'
import { pool } from '@/lib/aws/db'
import { auditPortalAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface VisitType {
  key: string
  label: string
  duration_minutes: number
  modality: 'in_person' | 'telehealth' | 'both'
}

interface SchedulingConfig {
  enabled?: boolean
  visit_types?: VisitType[]
  default_duration_minutes?: number
  buffer_minutes?: number
  lead_time_minutes?: number
  advance_window_days?: number
  allow_existing_patient_direct_book?: boolean
  allow_new_patient_inquiry?: boolean
  intake_visit_type_key?: string
}

export async function GET(req: NextRequest) {
  const sess = await requirePortalSession()
  if (sess instanceof NextResponse) return sess

  const visitTypeKey = req.nextUrl.searchParams.get('visit_type') ?? null

  const { rows } = await pool.query(
    `SELECT scheduling_config, hours
       FROM practices WHERE id = $1 LIMIT 1`,
    [sess.practiceId],
  )
  const cfg: SchedulingConfig = rows[0]?.scheduling_config ?? {}
  if (!cfg.enabled) {
    return NextResponse.json({ enabled: false, slots: [] })
  }

  const visitType = (cfg.visit_types ?? []).find((v) => v.key === visitTypeKey)
  const duration = visitType?.duration_minutes ?? cfg.default_duration_minutes ?? 50
  const buffer = cfg.buffer_minutes ?? 0
  const leadMin = cfg.lead_time_minutes ?? 60
  const windowDays = Math.min(cfg.advance_window_days ?? 14, 60)

  // Pull busy intervals within the window.
  const now = new Date()
  const startWindow = new Date(now.getTime() + leadMin * 60_000)
  const endWindow = new Date(now.getTime() + windowDays * 24 * 60 * 60_000)

  const busyRes = await pool.query(
    `SELECT scheduled_for, duration_minutes
       FROM appointments
      WHERE practice_id = $1
        AND status IN ('scheduled','confirmed','rescheduled')
        AND scheduled_for >= $2 AND scheduled_for <= $3`,
    [sess.practiceId, startWindow.toISOString(), endWindow.toISOString()],
  ).catch(() => ({ rows: [] as any[] }))

  // W49 T5 — calendar blocks (supervision, admin, lunch, etc.) also
  // make a slot busy. Recurring blocks are not yet expanded here;
  // an upcoming PR ports the W43 T1 recurrence expander to this
  // surface. The non-recurring case covers the bulk of practice usage.
  const blocksRes = await pool.query(
    `SELECT starts_at, ends_at
       FROM ehr_calendar_blocks
      WHERE practice_id = $1
        AND starts_at < $3 AND ends_at > $2
        AND COALESCE(is_recurring, FALSE) = FALSE`,
    [sess.practiceId, startWindow.toISOString(), endWindow.toISOString()],
  ).catch(() => ({ rows: [] as any[] }))

  type Busy = { start: number; end: number }
  const busy: Busy[] = [
    ...busyRes.rows.map((r: any) => {
      const s = new Date(r.scheduled_for).getTime()
      const dur = Number(r.duration_minutes ?? duration) * 60_000
      return { start: s - buffer * 60_000, end: s + dur + buffer * 60_000 }
    }),
    ...blocksRes.rows.map((r: any) => ({
      start: new Date(r.starts_at).getTime() - buffer * 60_000,
      end:   new Date(r.ends_at).getTime() + buffer * 60_000,
    })),
  ].sort((a, b) => a.start - b.start)

  // Generate candidate slots on 30-minute increments inside business hours.
  // Conservative default: 9-17 every weekday if hours JSONB is not set.
  const hours = (rows[0]?.hours ?? {}) as Record<string, { enabled?: boolean; openTime?: string; closeTime?: string }>
  const DAYS = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday']
  const slots: { start: string; end: string }[] = []

  const stepMs = 30 * 60_000
  const durMs = duration * 60_000
  let cursor = startWindow.getTime()
  cursor = Math.ceil(cursor / stepMs) * stepMs

  while (cursor + durMs <= endWindow.getTime()) {
    const d = new Date(cursor)
    const dow = DAYS[d.getDay()]
    const dayCfg = hours[dow]
    const dayEnabled = dayCfg?.enabled !== false
    const open = dayCfg?.openTime ?? '09:00'
    const close = dayCfg?.closeTime ?? '17:00'

    if (dayEnabled) {
      const [oh, om] = open.split(':').map(Number)
      const [ch, cm] = close.split(':').map(Number)
      const dayStart = new Date(d).setHours(oh, om, 0, 0)
      const dayEnd = new Date(d).setHours(ch, cm, 0, 0)
      const slotStart = cursor
      const slotEnd = cursor + durMs
      if (slotStart >= dayStart && slotEnd <= dayEnd) {
        const overlaps = busy.some((b) => slotStart < b.end && slotEnd > b.start)
        if (!overlaps) {
          slots.push({
            start: new Date(slotStart).toISOString(),
            end: new Date(slotEnd).toISOString(),
          })
        }
      }
    }
    cursor += stepMs
    if (slots.length >= 200) break
  }

  await auditPortalAccess({
    session: sess,
    action: 'portal.scheduling.availability',
    resourceType: 'scheduling_availability',
    details: { visit_type: visitTypeKey, slot_count: slots.length, duration },
  }).catch(() => {})

  return NextResponse.json({
    enabled: true,
    visit_type: visitType ?? null,
    duration_minutes: duration,
    buffer_minutes: buffer,
    slots,
  })
}
