// lib/ehr/event-types.ts
//
// W49 D4 — helpers for resolving a calendar_event_type row server-side.

import { pool } from '@/lib/aws/db'

export interface EventTypeRow {
  id: string
  practice_id: string
  name: string
  slug: string
  color: string
  default_duration_minutes: number
  default_cpt_codes: string[]
  allows_telehealth: boolean
  allows_in_person: boolean
  default_location_id: string | null
  requires_intake_form_id: string | null
  status: 'active' | 'archived'
  is_default: boolean
}

/**
 * Fetch one event type for a practice, or throw if missing / wrong practice.
 */
export async function getEventType(eventTypeId: string, practiceId: string): Promise<EventTypeRow | null> {
  const { rows } = await pool.query(
    `SELECT id, practice_id, name, slug, color, default_duration_minutes,
            default_cpt_codes, allows_telehealth, allows_in_person,
            default_location_id, requires_intake_form_id, status, is_default
       FROM calendar_event_types
      WHERE id = $1 AND practice_id = $2 AND status = 'active'
      LIMIT 1`,
    [eventTypeId, practiceId],
  )
  return (rows[0] as EventTypeRow | undefined) ?? null
}

/**
 * Default event type for a practice (the row flagged is_default), used
 * by callers that haven't picked one yet.
 */
export async function getDefaultEventType(practiceId: string): Promise<EventTypeRow | null> {
  const { rows } = await pool.query(
    `SELECT id, practice_id, name, slug, color, default_duration_minutes,
            default_cpt_codes, allows_telehealth, allows_in_person,
            default_location_id, requires_intake_form_id, status, is_default
       FROM calendar_event_types
      WHERE practice_id = $1 AND status = 'active'
      ORDER BY is_default DESC, sort_order ASC
      LIMIT 1`,
    [practiceId],
  )
  return (rows[0] as EventTypeRow | undefined) ?? null
}
