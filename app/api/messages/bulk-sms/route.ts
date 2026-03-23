import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { sendSMS, formatPhoneNumber } from '@/lib/twilio'

export async function POST(req: NextRequest) {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: practice } = await supabase
      .from('practices')
      .select('id, name')
      .eq('notification_email', user.email)
      .single()

    if (!practice) {
      return NextResponse.json({ error: 'Practice not found' }, { status: 404 })
    }

    const { message_template, recipient_type, date } = await req.json()

    if (!message_template?.trim()) {
      return NextResponse.json({ error: 'Message template required' }, { status: 400 })
    }

    // Build patient query based on recipient type
    let query = supabase
      .from('appointments')
      .select('patient_name, patient_phone, appointment_date, appointment_time')
      .eq('practice_id', practice.id)
      .not('patient_phone', 'is', null)
      .neq('patient_phone', '')
      .neq('status', 'cancelled')

    if (recipient_type === 'by_date' && date) {
      query = query.eq('appointment_date', date)
    } else if (recipient_type === 'upcoming') {
      const today = new Date().toISOString().split('T')[0]
      const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      query = query.gte('appointment_date', today).lte('appointment_date', nextWeek)
    }

    const { data: appointments, error } = await query

    if (error) {
      console.error('Failed to fetch appointments:', error)
      return NextResponse.json({ error: 'Failed to fetch patients' }, { status: 500 })
    }

    if (!appointments || appointments.length === 0) {
      return NextResponse.json({ sent: 0, failed: 0, total: 0 })
    }

    // Deduplicate by phone number
    const seen = new Set<string>()
    const recipients = appointments.filter(a => {
      if (!a.patient_phone || seen.has(a.patient_phone)) return false
      seen.add(a.patient_phone)
      return true
    })

    // Send personalized messages
    let sent = 0
    let failed = 0
    const errors: string[] = []

    for (const r of recipients) {
      try {
        const msg = message_template
          .replace(/\{\{patient_name\}\}/g, r.patient_name || 'Patient')
          .replace(/\{\{practice_name\}\}/g, practice.name || 'our practice')
          .replace(/\{\{appointment_date\}\}/g, r.appointment_date || '')
          .replace(/\{\{appointment_time\}\}/g, r.appointment_time || '')

        await sendSMS(formatPhoneNumber(r.patient_phone), msg)
        sent++
      } catch (e) {
        failed++
        errors.push(r.patient_name || 'Unknown patient')
      }
    }

    // Log the bulk send (best effort)
    try {
      await supabase.from('bulk_message_logs').insert({
        practice_id: practice.id,
        message_template,
        recipient_type,
        date_filter: date || null,
        sent_count: sent,
        failed_count: failed,
        sent_by: user.email,
      })
    } catch (_) {}

    return NextResponse.json({ sent, failed, total: recipients.length, errors: errors.slice(0, 5) })
  } catch (error) {
    console.error('Bulk SMS error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
