// Public confirmation page — hit from email reminder "Confirm" button.
// No auth required: the appointment UUID is the capability token.
// This is an intentional low-friction UX choice; if we ever need stronger
// protection we can add an HMAC-signed confirm_token column to appointments.

import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function ConfirmAppointmentPage({ params }: PageProps) {
  const { id } = await params

  const { data: appt, error } = await supabaseAdmin
    .from('appointments')
    .select('id, status, scheduled_at, practices(name, ai_name)')
    .eq('id', id)
    .maybeSingle()

  let statusLine = ''
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
      statusLine = `This appointment was already cancelled. If that's not right, please call ${practiceName}.`
    } else if (appt.status === 'confirmed') {
      statusLine = `You're already confirmed for ${apptTime}. See you then!`
    } else {
      // Transition any other active state to confirmed
      await supabaseAdmin
        .from('appointments')
        .update({ status: 'confirmed', confirmed_at: new Date().toISOString() })
        .eq('id', id)
      statusLine = `Confirmed! See you on ${apptTime}.`
    }
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
