// Public cancellation page — hit from email reminder "Cancel" button.
// Same capability-token rationale as /confirm. On cancel we also kick off
// the cancellation-fill flow to offer the slot to other patients, and —
// when the practice has opted into a cancellation policy — assess the
// late-cancel fee against the patient's saved card on file.

import { pool } from '@/lib/aws/db'
import { enforceLateCancelFee } from '@/lib/aws/ehr/cancellation-policy'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function CancelAppointmentPage({ params }: PageProps) {
  const { id } = await params

  let statusLine = ''
  let policyMessage: string | null = null
  let practiceName = 'your therapist'
  let aiName = 'Ellie'
  let apptTime = ''
  let policyText: string | null = null

  try {
    const { rows } = await pool.query(
      `SELECT a.id,
              a.status,
              a.scheduled_at,
              a.practice_id,
              p.name AS practice_name,
              p.ai_name AS practice_ai_name,
              p.cancellation_policy_text,
              p.cancellation_policy_hours,
              p.cancellation_fee_cents
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
      policyText = appt.cancellation_policy_text ?? null
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
        statusLine = `This appointment was already cancelled.`
      } else {
        await pool.query(
          `UPDATE appointments
              SET status = 'cancelled',
                  cancelled_at = NOW()
            WHERE id = $1`,
          [id],
        )

        statusLine = `Got it — your ${apptTime} appointment has been cancelled. ${practiceName} will reach out if you'd like to reschedule.`

        // Apply the practice's cancellation policy. The library is a no-op
        // when no policy is configured. Failure to charge never blocks the
        // cancellation; we surface a billable-on-invoice message when the
        // saved card is missing or declines.
        try {
          const fee = await enforceLateCancelFee(id, 'patient')
          if (fee.status === 'charged' && fee.amountCents) {
            policyMessage = `Per ${practiceName}'s cancellation policy, a $${(fee.amountCents / 100).toFixed(2)} late-cancellation fee was charged to the card on file.`
          } else if (fee.status === 'billable' && fee.amountCents) {
            policyMessage = `Per ${practiceName}'s cancellation policy, a $${(fee.amountCents / 100).toFixed(2)} late-cancellation fee will be added to your next invoice.`
          } else if (fee.status === 'failed' && fee.amountCents) {
            policyMessage = `Per ${practiceName}'s cancellation policy, a $${(fee.amountCents / 100).toFixed(2)} late-cancellation fee will be added to your next invoice.`
          }
        } catch (err) {
          console.error('[appointments/cancel] policy enforcement failed:', err)
        }

        // Fire cancellation-fill in the background; failure is non-fatal.
        try {
          await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/cancellation/fill`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              practiceId: appt.practice_id,
              appointmentId: id,
              slotTime: apptTime,
            }),
          })
        } catch (err) {
          console.error('[appointments/cancel] fill trigger failed:', err)
        }
      }
    }
  } catch (err) {
    console.error('[appointments/cancel] DB error:', err)
    statusLine = `We couldn't load that appointment right now. Please try again or contact your therapist's office.`
  }

  return (
    <main className="min-h-screen bg-[#f5f5f0] flex items-center justify-center p-6">
      <div className="max-w-lg w-full bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="bg-amber-600 text-white px-8 py-6">
          <h1 className="text-2xl font-semibold m-0">Appointment cancelled</h1>
        </div>
        <div className="p-8 space-y-4 text-gray-700">
          <p className="text-lg">{statusLine}</p>
          {policyMessage && (
            <p className="text-sm bg-amber-50 border border-amber-200 text-amber-900 rounded-lg px-3 py-2">
              {policyMessage}
            </p>
          )}
          {policyText && (
            <details className="text-xs text-gray-500">
              <summary className="cursor-pointer">Cancellation policy</summary>
              <p className="mt-2 whitespace-pre-line">{policyText}</p>
            </details>
          )}
          <p className="text-sm text-gray-500">— {aiName}, {practiceName}</p>
        </div>
      </div>
    </main>
  )
}
