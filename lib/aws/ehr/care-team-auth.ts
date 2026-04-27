// lib/aws/ehr/care-team-auth.ts
//
// Wave 42 / T4 — gate on adding/removing care-team members.
// Allowed if the caller is in ADMIN_EMAIL allowlist OR is a
// supervisor of any user already on this patient's team.

import { pool } from '@/lib/aws/db'

const ADMIN_EMAILS = (process.env.ADMIN_EMAIL || 'chancewonser@gmail.com')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)

export async function canManageCareTeam(args: {
  callerUserId: string
  callerEmail: string
  patientId: string
  practiceId: string
}): Promise<boolean> {
  if (ADMIN_EMAILS.includes(args.callerEmail.toLowerCase())) return true

  // Caller is a supervisor if any current care-team member's
  // users.supervisor_user_id is the caller's id.
  const { rowCount } = await pool.query(
    `SELECT 1
       FROM ehr_patient_care_team ct
       JOIN users u ON u.id = ct.user_id
      WHERE ct.practice_id = $1
        AND ct.patient_id  = $2
        AND ct.active      = TRUE
        AND u.supervisor_user_id = $3
      LIMIT 1`,
    [args.practiceId, args.patientId, args.callerUserId],
  ).catch(() => ({ rowCount: 0 }))
  return (rowCount ?? 0) > 0
}
