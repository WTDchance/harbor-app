// app/api/voice/tools/check-availability/route.ts
//
// Wave 27c — Retell tool: return open appointment slots on the
// requested day in the practice's local timezone. Computes intersection
// of practice hours_json with already-booked appointments. The
// agent presents the resulting slots to the caller and then
// follows with bookAppointment.

import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/aws/db'
import { parseRetellToolCall, toolResult } from '@/lib/aws/voice/auth'

const DEFAULT_DURATION_MIN = 50
const DEFAULT_TZ = 'America/Los_Angeles'

function parseDayKeyword(input: string, tz: string): Date | null {
  const lc = input.trim().toLowerCase()
  const now = new Date()
  if (lc === 'today') return now
  if (lc === 'tomorrow') return new Date(now.getTime() + 86_400_000)
  // Day-of-week
  const days = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday']
  const idx = days.indexOf(lc)
  if (idx >= 0) {
    const today = now.getUTCDay()
    const delta = (idx - today + 7) % 7 || 7
    return new Date(now.getTime() + delta * 86_400_000)
  }
  // Try as a parseable date (e.g. "April 20", "2026-04-21")
  const yearGuess = `${input}, ${now.getUTCFullYear()}`
  const candidates = [input, yearGuess]
  for (const c of candidates) {
    const d = new Date(c)
    if (!isNaN(d.getTime())) return d
  }
  return null
}

export async function POST(req: NextRequest) {
  const ctx = await parseRetellToolCall(req)
  if (ctx instanceof NextResponse) return ctx
  const { args, practiceId } = ctx as any

  if (!practiceId) {
    return toolResult("I'm not able to pull up the calendar right now. Let me take a message and the therapist will reach out with available times.")
  }

  const preferredDay = String(args.preferredDay || 'today')
  const preferredTime = String(args.preferredTime || '').toLowerCase()

  // Practice timezone + hours
  const { rows: pRows } = await pool.query(
    `SELECT timezone, hours FROM practices WHERE id = $1 LIMIT 1`,
    [practiceId],
  )
  const tz = pRows[0]?.timezone || DEFAULT_TZ
  const hours = pRows[0]?.hours || {}

  const targetDay = parseDayKeyword(preferredDay, tz)
  if (!targetDay) {
    return toolResult(`I had trouble understanding "${preferredDay}". Could you give me a specific day, like "Monday" or "April 20"?`)
  }

  const dateStr = targetDay.toISOString().slice(0, 10)
  const dayName = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'][targetDay.getUTCDay()]
  const dayConfig: any = hours?.[dayName]
  const enabled = dayConfig?.enabled ?? true
  const openTime: string = dayConfig?.openTime || '09:00'
  const closeTime: string = dayConfig?.closeTime || '17:00'

  if (!enabled) {
    return toolResult(`We're closed on ${dayName}. Could we try a different day?`)
  }

  // Pull existing appointments for that day
  const { rows: appts } = await pool.query(
    `SELECT scheduled_for, duration_minutes
       FROM appointments
      WHERE practice_id = $1
        AND scheduled_for::date = $2
        AND status IN ('scheduled','confirmed')`,
    [practiceId, dateStr],
  )

  const busyMins = new Set<number>()
  for (const a of appts) {
    const start = new Date(a.scheduled_for)
    const dur = a.duration_minutes || DEFAULT_DURATION_MIN
    const startMin = start.getUTCHours() * 60 + start.getUTCMinutes()
    for (let m = startMin; m < startMin + dur; m += 5) busyMins.add(m)
  }

  const [oh, om] = openTime.split(':').map(Number)
  const [ch, cm] = closeTime.split(':').map(Number)
  const openMin = oh * 60 + (om || 0)
  const closeMin = ch * 60 + (cm || 0)

  const slots: string[] = []
  for (let m = openMin; m + DEFAULT_DURATION_MIN <= closeMin; m += 30) {
    let conflict = false
    for (let k = m; k < m + DEFAULT_DURATION_MIN; k += 5) {
      if (busyMins.has(k)) { conflict = true; break }
    }
    if (!conflict) {
      const hh = Math.floor(m / 60)
      const mm = m % 60
      const ampm = hh < 12 ? 'AM' : 'PM'
      const hh12 = ((hh + 11) % 12) + 1
      slots.push(`${hh12}:${String(mm).padStart(2, '0')} ${ampm}`)
    }
  }

  // Filter by preferred time band
  let filtered = slots
  if (preferredTime) {
    if (/morning/.test(preferredTime)) filtered = slots.filter((s) => /AM/.test(s))
    else if (/afternoon/.test(preferredTime)) filtered = slots.filter((s) => /(12|1|2|3|4):/.test(s) && /PM/.test(s))
    else if (/evening/.test(preferredTime)) filtered = slots.filter((s) => /(5|6|7|8|9):/.test(s) && /PM/.test(s))
  }

  if (filtered.length === 0) {
    return toolResult(`I don't see any open slots on ${dayName} ${dateStr} that match. We could try a different day or time of day.`)
  }
  return toolResult(`On ${dayName} ${dateStr}, I have these times open: ${filtered.slice(0, 6).join(', ')}. Which works best?`)
}
