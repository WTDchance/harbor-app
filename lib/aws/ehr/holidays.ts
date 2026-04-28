/**
 * US federal holidays + per-practice custom holidays.
 *
 * Used by the recurrence expander to flag occurrences that land on
 * a holiday so the dashboard can surface them and the practice can
 * decide whether to skip, move, or keep the appointment. The flag
 * is informational only — the appointment is still created so a
 * human can act on it.
 *
 * Federal holidays observed (per 5 U.S.C. § 6103, common practice):
 *   New Year's Day (Jan 1)
 *   Martin Luther King Jr. Day (3rd Monday of January)
 *   Presidents' Day (3rd Monday of February)
 *   Memorial Day (last Monday of May)
 *   Juneteenth (Jun 19)
 *   Independence Day (Jul 4)
 *   Labor Day (1st Monday of September)
 *   Columbus Day (2nd Monday of October)
 *   Veterans Day (Nov 11)
 *   Thanksgiving (4th Thursday of November)
 *   Christmas Day (Dec 25)
 *
 * Note: This is a calendar-date check only. We do NOT shift to
 * the "observed" date when a fixed holiday falls on a weekend —
 * that would mask the underlying date and confuse the audit trail.
 * The dashboard can render an "observed Monday" hint separately.
 */

export interface HolidayInfo {
  name: string
  date: string // YYYY-MM-DD in the local calendar of the practice
}

/** Return the day-of-month of the Nth weekday in a given month. */
function nthWeekdayOfMonth(
  year: number,
  monthIndex0: number, // 0–11
  weekday: number, // 0=Sunday … 6=Saturday
  n: number, // 1=first … 5=fifth
): number {
  // First of month, in UTC to avoid local-tz drift.
  const first = new Date(Date.UTC(year, monthIndex0, 1))
  const firstWeekday = first.getUTCDay()
  const offset = (weekday - firstWeekday + 7) % 7
  return 1 + offset + (n - 1) * 7
}

/** Return the day-of-month of the LAST given weekday of a month. */
function lastWeekdayOfMonth(
  year: number,
  monthIndex0: number,
  weekday: number,
): number {
  // Day 0 of next month = last day of this month.
  const lastDay = new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate()
  const lastDate = new Date(Date.UTC(year, monthIndex0, lastDay))
  const lastWeekday = lastDate.getUTCDay()
  const offset = (lastWeekday - weekday + 7) % 7
  return lastDay - offset
}

/** Build the list of US federal holidays for a calendar year. */
export function usFederalHolidays(year: number): HolidayInfo[] {
  const fmt = (m: number, d: number) =>
    `${year}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`

  return [
    { name: "New Year's Day", date: fmt(0, 1) },
    {
      name: 'Martin Luther King Jr. Day',
      date: fmt(0, nthWeekdayOfMonth(year, 0, 1, 3)),
    },
    {
      name: "Presidents' Day",
      date: fmt(1, nthWeekdayOfMonth(year, 1, 1, 3)),
    },
    {
      name: 'Memorial Day',
      date: fmt(4, lastWeekdayOfMonth(year, 4, 1)),
    },
    { name: 'Juneteenth', date: fmt(5, 19) },
    { name: 'Independence Day', date: fmt(6, 4) },
    {
      name: 'Labor Day',
      date: fmt(8, nthWeekdayOfMonth(year, 8, 1, 1)),
    },
    {
      name: 'Columbus Day',
      date: fmt(9, nthWeekdayOfMonth(year, 9, 1, 2)),
    },
    { name: 'Veterans Day', date: fmt(10, 11) },
    {
      name: 'Thanksgiving Day',
      date: fmt(10, nthWeekdayOfMonth(year, 10, 4, 4)),
    },
    { name: 'Christmas Day', date: fmt(11, 25) },
  ]
}

/**
 * Quick check: does an ISO date (YYYY-MM-DD) fall on a US federal holiday?
 * Returns the holiday info if so, null otherwise.
 */
export function getUsFederalHoliday(isoDate: string): HolidayInfo | null {
  const year = Number(isoDate.slice(0, 4))
  if (!Number.isFinite(year)) return null
  const list = usFederalHolidays(year)
  return list.find((h) => h.date === isoDate) ?? null
}

export function isUsFederalHoliday(isoDate: string): boolean {
  return getUsFederalHoliday(isoDate) !== null
}

/**
 * Combine federal + per-practice custom holidays for a year and return
 * the merged list. Custom holidays override federal entries that share
 * the same date so a practice that wants to rename "Columbus Day" to
 * "Indigenous Peoples' Day" can do so without removing the federal entry.
 */
export function mergeHolidayLists(
  federal: HolidayInfo[],
  custom: HolidayInfo[],
): HolidayInfo[] {
  const map = new Map<string, HolidayInfo>()
  for (const h of federal) map.set(h.date, h)
  for (const h of custom) map.set(h.date, h)
  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date))
}
