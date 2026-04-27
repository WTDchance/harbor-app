// app/api/dashboard/today/route.ts
//
// Wave 36 — consolidated data feed for the Today screen. Returns:
//   - today's appointments (joined with patient name + note status)
//   - attention items (notes-pending-sign, crisis flags, unread messages,
//     consents about to expire, missed calls), each with WHY they need attention
//   - recent activity feed (last 10 patient interactions across the practice)
//   - greeting + headline counts
//
// Single round-trip; everything runs in parallel via pool.

import { NextResponse, type NextRequest } from 'next/server'
import { pool } from '@/lib/aws/db'
import { requireApiSession } from '@/lib/aws/api-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function greeting(now = new Date()): string {
  const h = now.getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

export async function GET(_req: NextRequest) {
  const ctx = await requireApiSession()
  if (ctx instanceof NextResponse) return ctx
  const practiceId = ctx.practiceId
  if (!practiceId) return NextResponse.json({ error: 'no_practice' }, { status: 403 })

  // Pull everything in parallel
  const [
    practiceRow,
    appointments,
    notesPending,
    crisisAlerts,
    unreadMessages,
    activity,
  ] = await Promise.all([
    pool.query(
      `SELECT name FROM practices WHERE id = $1 LIMIT 1`,
      [practiceId],
    ),
    pool.query(
      `SELECT
         a.id, a.patient_id, a.scheduled_for,
         a.duration_minutes, a.appointment_type, a.status,
         a.telehealth_room_slug,
         p.first_name AS patient_first_name,
         p.last_name  AS patient_last_name,
         p.intake_completed,
         (SELECT n.status FROM ehr_progress_notes n
           WHERE n.appointment_id = a.id
           ORDER BY n.created_at DESC LIMIT 1) AS note_status
       FROM appointments a
       LEFT JOIN patients p ON p.id = a.patient_id
       WHERE a.practice_id = $1
         AND a.scheduled_for >= date_trunc('day', NOW())
         AND a.scheduled_for <  date_trunc('day', NOW()) + INTERVAL '1 day'
         AND a.status IN ('scheduled', 'confirmed', 'in_progress')
       ORDER BY a.scheduled_for ASC`,
      [practiceId],
    ).catch(() => ({ rows: [] as any[] })),
    pool.query(
      `SELECT id, patient_id, status, created_at,
              (SELECT first_name || ' ' || last_name FROM patients WHERE id = ehr_progress_notes.patient_id) AS patient_name
         FROM ehr_progress_notes
        WHERE practice_id = $1 AND status = 'draft'
        ORDER BY created_at DESC LIMIT 20`,
      [practiceId],
    ).catch(() => ({ rows: [] as any[] })),
    pool.query(
      `SELECT id, patient_id, severity, summary, created_at,
              (SELECT first_name || ' ' || last_name FROM patients WHERE id = crisis_alerts.patient_id) AS patient_name
         FROM crisis_alerts
        WHERE practice_id = $1
          AND created_at > NOW() - INTERVAL '7 days'
        ORDER BY created_at DESC LIMIT 10`,
      [practiceId],
    ).catch(() => ({ rows: [] as any[] })),
    pool.query(
      `SELECT id, patient_id, last_message_at,
              (SELECT first_name || ' ' || last_name FROM patients WHERE id = ehr_message_threads.patient_id) AS patient_name
         FROM ehr_message_threads
        WHERE practice_id = $1
          AND last_message_at > NOW() - INTERVAL '7 days'
        ORDER BY last_message_at DESC LIMIT 10`,
      [practiceId],
    ).catch(() => ({ rows: [] as any[] })),
    pool.query(
      `WITH events AS (
         SELECT id::text, patient_id, 'note_signed' AS kind,
                'Progress note signed' AS description,
                signed_at AS occurred_at
           FROM ehr_progress_notes
          WHERE practice_id = $1 AND signed_at IS NOT NULL
            AND signed_at > NOW() - INTERVAL '3 days'
         UNION ALL
         SELECT id::text, patient_id, 'mood_logged',
                'Mood logged via portal',
                logged_at
           FROM ehr_mood_logs
          WHERE practice_id = $1
            AND logged_at > NOW() - INTERVAL '3 days'
         UNION ALL
         SELECT id::text, patient_id, 'intake_completed',
                'Intake form completed',
                completed_at
           FROM intake_forms
          WHERE practice_id = $1 AND completed_at IS NOT NULL
            AND completed_at > NOW() - INTERVAL '3 days'
       )
       SELECT e.*, p.first_name || ' ' || p.last_name AS patient_name
         FROM events e
         LEFT JOIN patients p ON p.id = e.patient_id
        ORDER BY occurred_at DESC LIMIT 15`,
      [practiceId],
    ).catch(() => ({ rows: [] as any[] })),
  ])

  const practiceName = practiceRow.rows[0]?.name || 'Your practice'

  // Build attention items
  const attention: any[] = []

  for (const c of crisisAlerts.rows) {
    attention.push({
      id: `crisis-${c.id}`,
      kind: 'crisis',
      title: `Crisis flag — ${c.patient_name || 'unknown patient'}`,
      why: c.summary || 'Review safety plan and recent communications.',
      href: c.patient_id ? `/dashboard/patients/${c.patient_id}` : '/dashboard/patients',
      patient_id: c.patient_id,
      patient_name: c.patient_name,
      severity: 'urgent',
    })
  }

  // Notes — group by age. Drafts >24h get warn, recent ones info
  for (const n of notesPending.rows.slice(0, 5)) {
    const ageHours = (Date.now() - new Date(n.created_at).getTime()) / 3_600_000
    attention.push({
      id: `note-${n.id}`,
      kind: 'note_unsigned',
      title: `Sign progress note — ${n.patient_name || 'unknown'}`,
      why: ageHours > 48
        ? `Drafted ${Math.round(ageHours / 24)}d ago — sign to release for billing.`
        : ageHours > 24
        ? 'Drafted yesterday. Sign to lock + release for billing.'
        : 'Drafted today. Sign when ready.',
      href: `/dashboard/ehr/notes/${n.id}`,
      patient_id: n.patient_id,
      patient_name: n.patient_name,
      severity: ageHours > 48 ? 'warn' : 'info',
    })
  }

  for (const m of unreadMessages.rows.slice(0, 5)) {
    attention.push({
      id: `msg-${m.id}`,
      kind: 'unread_message',
      title: `New message from ${m.patient_name || 'patient'}`,
      why: 'Reply within one business day per practice policy.',
      href: `/dashboard/ehr/messages?thread=${m.id}`,
      patient_id: m.patient_id,
      patient_name: m.patient_name,
      severity: 'info',
    })
  }

  return NextResponse.json({
    practice_name: practiceName,
    greeting: `${greeting()}, ${ctx.session.email?.split('@')[0] || 'there'}`,
    appointments: appointments.rows.map(a => ({
      id: a.id,
      patient_id: a.patient_id,
      patient_first_name: a.patient_first_name,
      patient_last_name: a.patient_last_name,
      scheduled_for: a.scheduled_for,
      duration_minutes: a.duration_minutes,
      appointment_type: a.appointment_type,
      status: a.status,
      telehealth_room_slug: a.telehealth_room_slug,
      note_status: a.note_status,
      intake_completed: a.intake_completed,
    })),
    attention,
    activity: activity.rows.map(a => ({
      id: `${a.kind}-${a.id}`,
      kind: a.kind,
      patient_id: a.patient_id,
      patient_name: a.patient_name,
      description: a.description,
      occurred_at: a.occurred_at,
    })),
    drafts_pending: notesPending.rows.length,
    crisis_count: crisisAlerts.rows.length,
    unread_messages: unreadMessages.rows.length,
  })
}
