// FILE: app/api/admin/phone-diag/route.ts
// Diagnostic endpoint for tracing a phone number across Harbor's stack.
//
// Auth: Bearer ${CRON_SECRET}
//
// GET /api/admin/phone-diag?phone=5415394890
//   → Searches for the number across:
//       - practices.phone_number
//       - practices.owner_phone
//       - call_logs.patient_phone (last 90 days)
//       - patients.phone
//       - auth.users by email (if ?email=X is also passed)
//       - Twilio account (all incoming numbers)
//     Returns a structured report so we can reconstruct what happened to a
//     number that went missing.
//
// The phone param is matched loosely — we normalize to digits and compare
// both "5415394890" and "+15415394890" forms.

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import twilio from 'twilio'

const accountSid = process.env.TWILIO_ACCOUNT_SID || ''
const authToken = process.env.TWILIO_AUTH_TOKEN || ''
const twilioClient = accountSid && authToken ? twilio(accountSid, authToken) : null

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

function normalizeDigits(v: string | null | undefined): string {
  return (v || '').replace(/\D/g, '')
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') || ''
  const expected = `Bearer ${process.env.CRON_SECRET || ''}`
  if (!process.env.CRON_SECRET || auth !== expected) return unauthorized()

  const rawPhone = req.nextUrl.searchParams.get('phone') || ''
  const email = req.nextUrl.searchParams.get('email') || ''
  const digits = normalizeDigits(rawPhone)
  // Fuzzy key: strip leading country code if present (10 digit US comparison)
  const tenDigit = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits

  if (!digits && !email) {
    return NextResponse.json({ error: 'phone or email required' }, { status: 400 })
  }

  const report: Record<string, any> = { query: { phone: rawPhone, digits, tenDigit, email } }

  // 1. practices — match phone_number or owner_phone (loose)
  const { data: allPractices } = await supabaseAdmin
    .from('practices')
    .select(
      'id, name, therapist_name, notification_email, phone_number, owner_phone, status, subscription_status, twilio_phone_sid, vapi_phone_number_id, vapi_assistant_id, stripe_customer_id, stripe_subscription_id, created_at'
    )
  const practiceMatches = (allPractices || []).filter((p) => {
    const pn = normalizeDigits(p.phone_number)
    const op = normalizeDigits(p.owner_phone)
    const phoneHit = digits
      ? pn === digits || op === digits || pn.endsWith(tenDigit) || op.endsWith(tenDigit)
      : false
    const emailHit = email ? (p.notification_email || '').toLowerCase() === email.toLowerCase() : false
    return phoneHit || emailHit
  })
  report.practices = {
    total_scanned: allPractices?.length || 0,
    matches: practiceMatches,
  }

  // 2. call_logs — last 90 days
  if (digits) {
    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
    const { data: calls } = await supabaseAdmin
      .from('call_logs')
      .select('id, practice_id, patient_phone, created_at, vapi_call_id')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(500)
    const callMatches = (calls || []).filter((c) => {
      const d = normalizeDigits(c.patient_phone)
      return d === digits || d.endsWith(tenDigit)
    })
    report.call_logs = { scanned: calls?.length || 0, matches: callMatches.slice(0, 20) }
  }

  // 3. patients table
  if (digits) {
    const { data: pts } = await supabaseAdmin
      .from('patients')
      .select('id, practice_id, first_name, last_name, phone, email, created_at')
      .limit(1000)
    const ptMatches = (pts || []).filter((p) => {
      const d = normalizeDigits(p.phone)
      return d === digits || d.endsWith(tenDigit)
    })
    report.patients = { scanned: pts?.length || 0, matches: ptMatches.slice(0, 20) }
  }

  // 4. auth.users by email (optional)
  if (email) {
    try {
      const { data } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 })
      const hit = (data?.users || []).filter((u) => (u.email || '').toLowerCase() === email.toLowerCase())
      report.auth_users = hit.map((u) => ({
        id: u.id,
        email: u.email,
        phone: u.phone,
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at,
        user_metadata: u.user_metadata,
      }))
    } catch (e: any) {
      report.auth_users_error = e?.message || String(e)
    }
  }

  // 5. Twilio — list incoming phone numbers and flag matches
  if (twilioClient && digits) {
    try {
      const numbers = await twilioClient.incomingPhoneNumbers.list({ limit: 200 })
      const numberInfo = numbers.map((n) => ({
        sid: n.sid,
        phone_number: n.phoneNumber,
        friendly_name: n.friendlyName,
        date_created: n.dateCreated,
        voice_url: n.voiceUrl,
        sms_url: n.smsUrl,
        status_callback: n.statusCallback,
      }))
      const matches = numberInfo.filter((n) => {
        const d = normalizeDigits(n.phone_number)
        return d === digits || d.endsWith(tenDigit)
      })
      report.twilio = {
        total: numberInfo.length,
        match: matches,
        all_numbers: numberInfo.map((n) => ({ sid: n.sid, phone_number: n.phone_number, friendly_name: n.friendly_name })),
      }
    } catch (e: any) {
      report.twilio_error = e?.message || String(e)
    }
  } else if (!twilioClient) {
    report.twilio_error = 'Twilio client not configured (missing TWILIO_ACCOUNT_SID/AUTH_TOKEN)'
  }

  return NextResponse.json(report)
}
