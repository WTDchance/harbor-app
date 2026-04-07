// Call forwarding schedule evaluator.
//
// Given a practice's forwarding config and the current time, decides whether
// an inbound call should be forwarded to the therapist or handed to Ellie.
//
// This is pure logic — no DB, no Twilio — so it's easy to unit test.

export type ForwardingMode = 'off' | 'always' | 'schedule' | 'after_hours'

export type ScheduleEntry = {
  day: 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'
  start: string // "HH:MM" 24h
  end: string   // "HH:MM" 24h
}

export type ForwardingConfig = {
  call_forwarding_enabled: boolean
  call_forwarding_mode: ForwardingMode
  call_forwarding_number: string | null
  call_forwarding_schedule: ScheduleEntry[] | null
  call_forwarding_fallback: 'ellie' | 'voicemail'
  timezone: string                       // IANA, e.g. "America/Los_Angeles"
  business_hours: ScheduleEntry[] | null
}

export type RoutingDecision =
  | { action: 'ellie' }                                          // Vapi handles it
  | { action: 'forward', number: string, fallback: 'ellie' | 'voicemail' }

const DAY_CODES: ScheduleEntry['day'][] = ['sun','mon','tue','wed','thu','fri','sat']

/**
 * Convert "HH:MM" to minutes-since-midnight.
 */
function parseHM(hm: string): number {
  const [h, m] = hm.split(':').map(Number)
  return h * 60 + (m || 0)
}

/**
 * Get the current day code + minutes-of-day in the practice's timezone.
 * Uses Intl.DateTimeFormat for DST-correct zone handling.
 */
function nowInZone(timezone: string, now: Date = new Date()): {
  day: ScheduleEntry['day']
  minutes: number
} {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const parts = fmt.formatToParts(now)
  const weekday = parts.find(p => p.type === 'weekday')?.value.toLowerCase().slice(0,3) as ScheduleEntry['day']
  const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10)
  const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10)
  // Intl may return '24' for midnight on some runtimes — normalize.
  const hh = hour === 24 ? 0 : hour
  return { day: weekday, minutes: hh * 60 + minute }
}

/**
 * Is the given moment inside any entry of the schedule?
 */
function isInSchedule(schedule: ScheduleEntry[], day: ScheduleEntry['day'], minutes: number): boolean {
  for (const entry of schedule) {
    if (entry.day !== day) continue
    const start = parseHM(entry.start)
    const end = parseHM(entry.end)
    if (minutes >= start && minutes < end) return true
  }
  return false
}

/**
 * Main routing decision function.
 * Returns whether to let Ellie handle the call or forward it.
 */
export function decideRouting(
  config: ForwardingConfig,
  now: Date = new Date()
): RoutingDecision {
  // Safety: forwarding disabled, or no number configured → Ellie
  if (!config.call_forwarding_enabled) return { action: 'ellie' }
  if (!config.call_forwarding_number) return { action: 'ellie' }
  if (config.call_forwarding_mode === 'off') return { action: 'ellie' }

  const forward = (): RoutingDecision => ({
    action: 'forward',
    number: config.call_forwarding_number!,
    fallback: config.call_forwarding_fallback,
  })

  if (config.call_forwarding_mode === 'always') return forward()

  const { day, minutes } = nowInZone(config.timezone)

  if (config.call_forwarding_mode === 'schedule') {
    const schedule = config.call_forwarding_schedule || []
    return isInSchedule(schedule, day, minutes) ? forward() : { action: 'ellie' }
  }

  if (config.call_forwarding_mode === 'after_hours') {
    // Forward when OUTSIDE business hours.
    const hours = config.business_hours || []
    return isInSchedule(hours, day, minutes) ? { action: 'ellie' } : forward()
  }

  return { action: 'ellie' }
}

/**
 * Generate TwiML for a forwarding decision.
 */
export function twimlForDecision(
  decision: RoutingDecision,
  vapiTwimlUrl: string,
  callerFrom?: string
): string {
  if (decision.action === 'ellie') {
    // Delegate to Vapi. The cleanest way is a <Redirect> so Twilio fetches
    // Vapi's TwiML and Vapi takes over the call.
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Redirect method="POST">${vapiTwimlUrl}</Redirect>
</Response>`
  }

  // Forward: dial the therapist, with fallback behavior if they don't answer.
  const timeoutAction =
    decision.fallback === 'ellie'
      ? `<Redirect method="POST">${vapiTwimlUrl}</Redirect>`
      : `<Say voice="Polly.Joanna">Please leave a message after the tone.</Say><Record maxLength="120" />`

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial timeout="20" callerId="${callerFrom || ''}">
    <Number>${decision.number}</Number>
  </Dial>
  ${timeoutAction}
</Response>`
}
