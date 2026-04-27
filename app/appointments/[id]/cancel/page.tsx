// Public cancellation page — hit from email reminder "Cancel" button.
// Same capability-token rationale as /confirm. On cancel we also kick off
// the cancellation-fill flow to offer the slot to other patients, and —
// when the practice has opted into a cancellation policy — assess the
// late-cancel fee against the patient's saved card on file.

import { supabaseAdmin } from '@/lib/supabase'
import { enforceLateCancelFee } from '@/lib/aws/ehr/cancellation-policy'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function CancelAppointmentPage({ params }: PageProps) {
  const { id } = await params

  const { data: appt, error } = await supabaseAdmin
    .from('appointments')
    .select('id, status, scheduled_at, practice_id, practices(name, ai_name, cancellation_policy_text, cancellation_policy_hours, cancellation_fee_cents)')
    .eq('id', id)
    .maybeSingle()

  let statusLine = ''
  let policyMessage: string | null = null
  let practiceName = 'your therapist'
  let aiName = 'Ellie'
  let apptTime = ''

  if (error || !appt) {
    statusLine = `We couldn't find that appointment. Please contact your therapist's office directly.`
  } else {
    const practice = (appt as any).practices
    practiceName = practice?.name || practiceName
    aiName = practice?.ai_name || aiName
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
      await supabaseAdmin
        .from('appointments')
        .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
        .eq('id', id)

      statusLine = `Got it — your ${apptTime} appointment has been cancelled. ${practiceName} will reach out if you'd like to reschedule.`

      // Apply the practice's cancellation policy. The library is a
      // no-op when no policy is configured. Failure to charge never
      // blocks the cancellation; we surface a billable-on-invoice
      // message when the saved card is missing or declines.
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
      const slotTime = apptTime
      try {
        await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/cancellation/fill`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            practiceId: (appt as any).practice_id,
            appointmentId: id,
            slotTime,
          }),
        })
      } catch (err) {
        console.error('[appointments/cancel] fill trigger failed:', err)
      }
    }
  }

  const policyText: string | null = (appt as any)?.practices?.cancellation_policy_text ?? null

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
