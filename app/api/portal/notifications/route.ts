// app/api/portal/notifications/route.ts — Wave 50.
//
// GET  → return the patient's current notification preferences.
// PUT  → update them (boolean toggles only).
//
// account_creation and password_reset are not represented here; the SES
// wrapper enforces that those are always sent regardless of any patient/
// user preference state.

import { NextResponse, type NextRequest } from 'next/server'
import { pool } from '@/lib/aws/db'
import { auditPortalAccess } from '@/lib/aws/ehr/audit'
import { requirePortalSession } from '@/lib/aws/portal-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Prefs = {
  appointment_reminders_enabled: boolean
  intake_invitations_enabled: boolean
  custom_form_invitations_enabled: boolean
  payment_receipts_enabled: boolean
}

const PREF_KEYS: Array<keyof Prefs> = [
  'appointment_reminders_enabled',
  'intake_invitations_enabled',
  'custom_form_invitations_enabled',
  'payment_receipts_enabled',
]

export async function GET(_req: NextRequest) {
  const sess = await requirePortalSession()
  if (sess instanceof NextResponse) return sess

  const r = await pool.query<Prefs>(
    `SELECT
       COALESCE(appointment_reminders_enabled, TRUE) AS appointment_reminders_enabled,
       COALESCE(intake_invitations_enabled, TRUE) AS intake_invitations_enabled,
       COALESCE(custom_form_invitations_enabled, TRUE) AS custom_form_invitations_enabled,
       COALESCE(payment_receipts_enabled, TRUE) AS payment_receipts_enabled
       FROM patients
      WHERE id = $1`,
    [sess.patientId],
  )

  const prefs = r.rows[0] ?? {
    appointment_reminders_enabled: true,
    intake_invitations_enabled: true,
    custom_form_invitations_enabled: true,
    payment_receipts_enabled: true,
  }

  return NextResponse.json({ prefs })
}

export async function PUT(req: NextRequest) {
  const sess = await requirePortalSession()
  if (sess instanceof NextResponse) return sess

  let body: Partial<Prefs>
  try {
    body = (await req.json()) as Partial<Prefs>
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  // Only accept booleans for known keys — silently ignore unknowns.
  const updates: Array<{ col: keyof Prefs; val: boolean }> = []
  for (const key of PREF_KEYS) {
    const v = body[key]
    if (typeof v === 'boolean') updates.push({ col: key, val: v })
  }
  if (updates.length === 0) {
    return NextResponse.json({ error: 'no_updates' }, { status: 400 })
  }

  const setClauses = updates
    .map((u, i) => `${u.col} = $${i + 1}`)
    .join(', ')
  const values: unknown[] = updates.map(u => u.val)
  values.push(sess.patientId)
  await pool.query(
    `UPDATE patients SET ${setClauses} WHERE id = $${values.length}`,
    values,
  )

  await auditPortalAccess({
    session: sess,
    action: 'portal.me.view', // closest existing action; preferences view
    resourceType: 'notification_preferences',
    details: {
      updated_keys: updates.map(u => u.col),
      new_values: Object.fromEntries(updates.map(u => [u.col, u.val])),
    },
  })

  return NextResponse.json({ ok: true })
}
