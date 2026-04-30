// Public confirmation page — hit from email/SMS reminder "Confirm" button.
// No auth required: the appointment UUID is the capability token.
// This is an intentional low-friction UX choice; if we ever need stronger
// protection we can add an HMAC-signed confirm_token column to appointments.

import { pool } from '@/lib/aws/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function ConfirmAppointmentPage({ params }: PageProps) {
  const { id } = await params

  let statusLine = ''
  let practiceName = 'your therapist'
  let aiName = 'Ellie'
  let apptTime = ''

  try {
    const { rows } = await pool.query(
      `SELECT a.id,
              a.status,
              a.scheduled_at,
              p.name AS practice_name,
              p.ai_name AS practice_ai_name
         FROM appointments a
         LEFT JOIN practices p ON p.id = a.practice_id
        WHERE a.id = $1
        LIMIT 1`,
      [id],
    )
    const appt = rows[0]

    if (!appt) {
      statusLine = `We couldn't find that appointment. Please contact your therapist's office directly.`
    } else {
      practiceName = appt.practice_name || practiceName
      aiName = appt.practice_ai_name || aiName
      apptTime = appt.scheduled_at
        ? new Date(appt.scheduled_at).toLocaleString('en-US', {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
          })
        : ''

      if (appt.status === 'cancelled') {
        statusLine = `This appointment was already cancelled. If that's not right, please call ${practiceName}.`
      } else if (appt.status === 'confirmed') {
        statusLine = `You're already confirmed for ${apptTime}. See you then!`
      } else {
        // Transition any other active state to confirmed
        await pool.query(
          `UPDATE appointments
              SET status = 'confirmed',
                  confirmed_at = NOW()
            WHERE id = $1`,
          [id],
        )
        statusLine = `Confirmed! See you on ${apptTime}.`
      }
    }
  } catch {
    statusLine = `We couldn't load that appointment right now. Please try again or contact your therapist's office.`
  }

  return (
    <main className="min-h-screen bg-[#f5f5f0] flex items-center justify-center p-6">
      <div className="max-w-lg w-full bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="bg-teal-600 text-white px-8 py-6">
          <h1 className="text-2xl font-semibold m-0">Appointment confirmed</h1>
        </div>
        <div className="p-8 space-y-4 text-gray-700">
          <p className="text-lg">{statusLine}</p>
          <p className="text-sm text-gray-500">— {aiName}, {practiceName}</p>
        </div>
      </div>
    </main>
  )
}
