import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase'
import { purchaseTwilioNumber, releaseTwilioNumber } from '@/lib/twilio-provision'
import { createVapiAssistant, linkVapiPhoneNumber, deleteVapiAssistant } from '@/lib/vapi-provision'
import { sendWelcomeEmail } from '@/lib/email-welcome'

// POST /api/admin/signups/[id]/retry
// Re-runs the Twilio + Vapi provisioning for a practice that failed the first time.
// Admin-only. Safe to call multiple times — idempotent per resource.
export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminEmail = process.env.ADMIN_EMAIL
    if (!adminEmail || user.email !== adminEmail) {
      return NextResponse.json({ error: 'Forbidden — admin only' }, { status: 403 })
    }

    const practiceId = params.id
    const { data: practice, error: loadError } = await supabaseAdmin
      .from('practices')
      .select('*')
      .eq('id', practiceId)
      .maybeSingle()

    if (loadError || !practice) {
      return NextResponse.json({ error: 'Practice not found' }, { status: 404 })
    }

    // Bump the attempt counter up-front so it's visible even if the retry hangs.
    await supabaseAdmin
      .from('practices')
      .update({
        provisioning_attempts: (practice.provisioning_attempts || 0) + 1,
        provisioning_error: null,
      })
      .eq('id', practiceId)

    let newPhoneSid: string | null = practice.twilio_phone_sid || null
    let newAssistantId: string | null = practice.vapi_assistant_id || null

    try {
      // 1. Twilio — only purchase if we don't already have a number.
      let phoneNumber = practice.phone_number as string | null
      if (!phoneNumber || !newPhoneSid) {
        const purchased = await purchaseTwilioNumber({
          state: practice.state || undefined,
          friendlyName: `Harbor – ${practice.name}`,
        })
        phoneNumber = purchased.phoneNumber
        newPhoneSid = purchased.sid
      }

      // 2. Vapi assistant — only create if we don't already have one.
      if (!newAssistantId) {
        const assistant = await createVapiAssistant({
          id: practice.id,
          name: practice.name,
          providerName: practice.therapist_name,
          aiName: practice.ai_name || 'Ellie',
          greeting: practice.greeting || undefined,
          specialties: practice.specialties || [],
          insuranceAccepted: practice.insurance_accepted || [],
          location: [practice.city, practice.state].filter(Boolean).join(', '),
          telehealth: !!practice.telehealth,
          timezone: practice.timezone || 'America/Los_Angeles',
        })
        newAssistantId = assistant.id
      }

      // 3. Link Vapi phone number (idempotent — Vapi will update if already linked).
      let vapiPhoneNumberId = practice.vapi_phone_number_id as string | null
      if (!vapiPhoneNumberId && phoneNumber && newAssistantId) {
        const linked = await linkVapiPhoneNumber({
          phoneNumber,
          assistantId: newAssistantId,
          name: practice.name,
        })
        vapiPhoneNumberId = linked.id
      }

      // 4. Mark practice active
      await supabaseAdmin
        .from('practices')
        .update({
          status: 'active',
          subscription_status: practice.subscription_status === 'unpaid'
            ? 'active'
            : practice.subscription_status,
          phone_number: phoneNumber,
          twilio_phone_sid: newPhoneSid,
          vapi_assistant_id: newAssistantId,
          vapi_phone_number_id: vapiPhoneNumberId,
          provisioned_at: new Date().toISOString(),
          provisioning_error: null,
        })
        .eq('id', practiceId)

      // 5. Re-send welcome email (fire-and-forget)
      if (practice.notification_email && phoneNumber) {
        sendWelcomeEmail({
          to: practice.notification_email,
          practiceName: practice.name,
          aiName: practice.ai_name || 'Ellie',
          phoneNumber,
          foundingMember: !!practice.founding_member,
        }).catch((e) => console.error('[retry] welcome email failed:', e))
      }

      console.log(`[admin/signups/retry] ${user.email} successfully retried ${practiceId}`)

      return NextResponse.json({
        success: true,
        practice_id: practiceId,
        phone_number: phoneNumber,
        vapi_assistant_id: newAssistantId,
      })
    } catch (provisionError: any) {
      console.error('[admin/signups/retry] provision failed:', provisionError)

      // Best-effort rollback of anything we created this attempt.
      if (!practice.twilio_phone_sid && newPhoneSid) {
        releaseTwilioNumber(newPhoneSid).catch(() => {})
      }
      if (!practice.vapi_assistant_id && newAssistantId) {
        deleteVapiAssistant(newAssistantId).catch(() => {})
      }

      await supabaseAdmin
        .from('practices')
        .update({
          status: 'provisioning_failed',
          provisioning_error:
            provisionError?.message || String(provisionError) || 'Unknown error',
        })
        .eq('id', practiceId)

      return NextResponse.json(
        {
          error: 'Provisioning failed',
          message: provisionError?.message || String(provisionError),
        },
        { status: 500 }
      )
    }
  } catch (err) {
    console.error('[admin/signups/retry] unhandled error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

