// lib/aws/ehr/recurrence.ts
//
// Wave 38 TS1 — minimal RFC 5545 RRULE expander tailored to the
// scheduling picker presets (None / Weekly / Biweekly / Monthly /
// Custom). Supports the subset of RRULE we actually emit + the most
// common custom inputs:
//
//   FREQ          ::= WEEKLY | DAILY | MONTHLY | YEARLY
//   INTERVAL      ::= positive integer (default 1)
//   COUNT         ::= positive integer (overrides UNTIL)
//   UNTIL         ::= YYYYMMDDTHHMMSSZ (UTC, RFC 5545 form)
//   BYDAY         ::= MO,TU,WE,TH,FR,SA,SU (weekly only; collapses to
//                     the start day if absent)
//
// We DO NOT implement BYMONTHDAY / BYSETPOS / EXDATE / RDATE — practices
// scheduling weekly therapy sessions don't need them, and a richer RRULE
// engine (rrule.js) can drop in later behind the same expand() signature.
//
// Wave 43 T1: optional `timezone` argument preserves wall-clock time
// across DST boundaries (a 9am PST appointment stays 9am after DST
// flips to PDT). When the offset shifts between the anchor start and
// an expanded occurrence we flag `dstAdjusted: true` so the API layer
// can stamp `appointments.dst_adjusted`. Holiday detection lives in
// `holidays.ts`; the API decorates occurrences with `holidayException`
// at write time.

export type ExpandedOccurrence = {
  startUtcIso: string
  /** True when the UTC instant was shifted to preserve the local clock
   *  time across a DST transition relative to the anchor start. */
  dstAdjusted?: boolean
}

export type ParsedRRule = {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'
  interval: number
  count?: number
  untilUtc?: Date
  byDay?: Array<'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU'>
}

const PRESETS: Record<string, string> = {
  none: '',
  weekly: 'FREQ=WEEKLY;COUNT=12',
  biweekly: 'FREQ=WEEKLY;INTERVAL=2;COUNT=12',
  monthly: 'FREQ=MONTHLY;COUNT=12',
}

export function presetToRrule(preset: string): string | null {
  if (preset === 'none' || !preset) return null
  if (preset in PRESETS) return PRESETS[preset] || null
  // assume already an RRULE
  return preset
}

export function parseRrule(rule: string): ParsedRRule | null {
  if (!rule) return null
  // Tolerate "RRULE:FREQ=..." prefix
  const cleaned = rule.replace(/^RRULE:/i, '').trim()
  const parts = cleaned.split(';').filter(Boolean)
  const map: Record<string, string> = {}
  for (const p of parts) {
    const eq = p.indexOf('=')
    if (eq < 0) return null
    map[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1)
  }
  const freq = (map.FREQ || '').toUpperCase()
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) return null
  const interval = Math.max(1, parseInt(map.INTERVAL || '1', 10) || 1)
  const count = map.COUNT ? Math.max(1, parseInt(map.COUNT, 10) || 0) : undefined
  let untilUtc: Date | undefined
  if (map.UNTIL) {
    const m = map.UNTIL.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?$/)
    if (m) {
      untilUtc = new Date(Date.UTC(
        +m[1], +m[2] - 1, +m[3],
        m[4] ? +m[4] : 0, m[5] ? +m[5] : 0, m[6] ? +m[6] : 0,
      ))
    }
  }
  let byDay: ParsedRRule['byDay']
  if (map.BYDAY) {
    byDay = map.BYDAY.split(',')
      .map(d => d.trim().toUpperCase())
      .filter(d => ['MO','TU','WE','TH','FR','SA','SU'].includes(d)) as any
  }
  return { freq: freq as any, interval, count, untilUtc, byDay }
}

const DAY_INDEX: Record<string, number> = {
  SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6,
}

/**
 * Return the offset (in minutes) east of UTC for a given UTC instant
 * in the supplied IANA timezone. e.g. America/Los_Angeles is -480
 * during PST and -420 during PDT. Returns 0 if the timezone is invalid
 * or if Intl is unavailable (we fall back to UTC, which is what the
 * pre-W43 expander assumed).
 */
export function tzOffsetMinutes(utcDate: Date, timezone: string): number {
  if (!timezone) return 0
  try {
    // Format the UTC instant as if it were in `timezone`, then parse it
    // back as if it were UTC. The delta is the offset.
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    })
    const parts = fmt.formatToParts(utcDate).reduce<Record<string, string>>((acc, p) => {
      if (p.type !== 'literal') acc[p.type] = p.value
      return acc
    }, {})
    const asUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour) === 24 ? 0 : Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    )
    return Math.round((asUtc - utcDate.getTime()) / 60_000)
  } catch {
    return 0
  }
}

/**
 * Adjust a UTC Date so its wall-clock representation in `timezone`
 * matches the wall-clock representation of `anchor` in `timezone`.
 *
 * Returns the (possibly shifted) Date and a `dstAdjusted` flag that's
 * true iff the offset between anchor and target differed (meaning we
 * crossed a DST boundary).
 */
export function preserveLocalClock(
  target: Date,
  anchor: Date,
  timezone: string,
): { date: Date; dstAdjusted: boolean } {
  if (!timezone) return { date: target, dstAdjusted: false }
  const anchorOffset = tzOffsetMinutes(anchor, timezone)
  const targetOffset = tzOffsetMinutes(target, timezone)
  if (anchorOffset === targetOffset) {
    return { date: target, dstAdjusted: false }
  }
  // If target's offset is +60 vs anchor (e.g. PST → PDT), the same
  // wall-clock moment is +60 minutes earlier in UTC; subtract.
  const deltaMs = (targetOffset - anchorOffset) * 60_000
  return { date: new Date(target.getTime() - deltaMs), dstAdjusted: true }
}

/**
 * Expand a parsed RRULE starting from `start` into UTC occurrence ISO
 * strings. The first occurrence is `start` itself unless BYDAY excludes
 * its weekday (in which case we advance to the next valid day).
 *
 * `maxOccurrences` is a hard cap so a misconfigured rule can't
 * produce 100k rows.
 */
export function expand(start: Date, rule: ParsedRRule, maxOccurrences = 12, timezone?: string): ExpandedOccurrence[] {
  const out: ExpandedOccurrence[] = []
  const cap = Math.min(rule.count ?? maxOccurrences, maxOccurrences)
  const days = rule.byDay && rule.byDay.length
    ? rule.byDay.map(d => DAY_INDEX[d]).sort((a, b) => a - b)
    : null

  if (rule.freq === 'WEEKLY') {
    // Anchor on start; emit on each BYDAY (or just start's weekday) in the
    // anchor week, then jump INTERVAL weeks.
    const weekStart = new Date(Date.UTC(
      start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate(),
      start.getUTCHours(), start.getUTCMinutes(), start.getUTCSeconds(),
    ))
    // Move back to Sunday for clean week alignment
    const sunday = new Date(weekStart)
    sunday.setUTCDate(sunday.getUTCDate() - sunday.getUTCDay())

    let weekIdx = 0
    while (out.length < cap) {
      const targetDays = days || [start.getUTCDay()]
      for (const dow of targetDays) {
        const d = new Date(sunday)
        d.setUTCDate(d.getUTCDate() + weekIdx * 7 * rule.interval + dow)
        // Carry HH:MM:SS from the original start (sunday was set with start's clock above)
        // Skip occurrences strictly before `start`.
        if (d.getTime() < start.getTime() - 60_000) continue
        if (rule.untilUtc && d.getTime() > rule.untilUtc.getTime()) {
          return out
        }
        const adj = timezone
          ? preserveLocalClock(d, start, timezone)
          : { date: d, dstAdjusted: false }
        out.push({
          startUtcIso: adj.date.toISOString(),
          dstAdjusted: adj.dstAdjusted || undefined,
        })
        if (out.length >= cap) return out
      }
      weekIdx++
      if (weekIdx > 520) break // belt-and-braces
    }
    return out
  }

  if (rule.freq === 'DAILY') {
    let d = new Date(start)
    while (out.length < cap) {
      if (rule.untilUtc && d.getTime() > rule.untilUtc.getTime()) return out
      const adj = timezone
        ? preserveLocalClock(d, start, timezone)
        : { date: d, dstAdjusted: false }
      out.push({
        startUtcIso: adj.date.toISOString(),
        dstAdjusted: adj.dstAdjusted || undefined,
      })
      d = new Date(d.getTime() + rule.interval * 86_400_000)
    }
    return out
  }

  if (rule.freq === 'MONTHLY') {
    let d = new Date(start)
    while (out.length < cap) {
      if (rule.untilUtc && d.getTime() > rule.untilUtc.getTime()) return out
      const adj = timezone
        ? preserveLocalClock(d, start, timezone)
        : { date: d, dstAdjusted: false }
      out.push({
        startUtcIso: adj.date.toISOString(),
        dstAdjusted: adj.dstAdjusted || undefined,
      })
      const next = new Date(d)
      next.setUTCMonth(next.getUTCMonth() + rule.interval)
      d = next
    }
    return out
  }

  if (rule.freq === 'YEARLY') {
    let d = new Date(start)
    while (out.length < cap) {
      if (rule.untilUtc && d.getTime() > rule.untilUtc.getTime()) return out
      const adj = timezone
        ? preserveLocalClock(d, start, timezone)
        : { date: d, dstAdjusted: false }
      out.push({
        startUtcIso: adj.date.toISOString(),
        dstAdjusted: adj.dstAdjusted || undefined,
      })
      const next = new Date(d)
      next.setUTCFullYear(next.getUTCFullYear() + rule.interval)
      d = next
    }
    return out
  }

  return out
}

/**
 * Convenience wrapper: take an UTC start ISO + a rule string, return the
 * next N occurrences (always including the start as occurrence 0).
 */
export function nextOccurrences(startIso: string, rule: string, n = 12, timezone?: string): string[] {
  const start = new Date(startIso)
  if (Number.isNaN(start.getTime())) return []
  const parsed = parseRrule(rule)
  if (!parsed) return [startIso]
  return expand(start, parsed, n, timezone).map(e => e.startUtcIso)
}
