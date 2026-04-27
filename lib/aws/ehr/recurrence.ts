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

export type ExpandedOccurrence = { startUtcIso: string }

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
 * Expand a parsed RRULE starting from `start` into UTC occurrence ISO
 * strings. The first occurrence is `start` itself unless BYDAY excludes
 * its weekday (in which case we advance to the next valid day).
 *
 * `maxOccurrences` is a hard cap so a misconfigured rule can't
 * produce 100k rows.
 */
export function expand(start: Date, rule: ParsedRRule, maxOccurrences = 12): ExpandedOccurrence[] {
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
        out.push({ startUtcIso: d.toISOString() })
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
      out.push({ startUtcIso: d.toISOString() })
      d = new Date(d.getTime() + rule.interval * 86_400_000)
    }
    return out
  }

  if (rule.freq === 'MONTHLY') {
    let d = new Date(start)
    while (out.length < cap) {
      if (rule.untilUtc && d.getTime() > rule.untilUtc.getTime()) return out
      out.push({ startUtcIso: d.toISOString() })
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
      out.push({ startUtcIso: d.toISOString() })
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
export function nextOccurrences(startIso: string, rule: string, n = 12): string[] {
  const start = new Date(startIso)
  if (Number.isNaN(start.getTime())) return []
  const parsed = parseRrule(rule)
  if (!parsed) return [startIso]
  return expand(start, parsed, n).map(e => e.startUtcIso)
}
