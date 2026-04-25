// Stripe webhook handler â expanded to handle checkout.session.completed,
// which triggers the full Twilio + Vapi provisioning pipeline for new
// practices on the card-upfront signup flow.

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { verifyWebhookSignature } from '@/lib/stripe'
import { purchaseTwilioNumber, releaseTwilioNumber } from '@/lib/twilio-provision'
import { createVapiAssistant, linkVapiPhoneNumber, deleteVapiAssistant } from '@/lib/vapi-provision'
import { sendWelcomeEmail } from '@/lib/email-welcome'

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || ''

export async function POST(request: NextRequest) {
  try {
    const signature = request.headers.get('stripe-signature')
    if (!signature) {
      console.warn('â ï¸ No Stripe signature header')
      return NextResponse.json({ error: 'No signature' }, { status: 400 })
    }

    const body = await request.text()
    const event = verifyWebhookSignature(body, signature, webhookSecret)
    if (!event) {
      console.warn('â Invalid Stripe signature')
      return NextResponse.json({ error: 'Invalid signature' }, { status: 403 })
    }

    console.log(`ð³ Stripe webhook: ${event.type}`)

    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object as any)
        break

      case 'customer.subscription.created':
        await handleSubscriptionCreated(event.data.object as any)
        break

      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object as any)
        break

      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object as any)
        break

      case 'invoice.payment_succeeded':
        await handlePaymentSucceeded(event.data.object as any)
        break

      case 'invoice.payment_failed':
        await handlePaymentFailed(event.data.object as any)
        break
    }

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error('â Stripe webhook error:', error)
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 })
  }
}

/**
 * checkout.session.completed â first successful payment for a new practice.
 * This is where we actually provision the Twilio number and the Vapi
 * assistant. Runs once per signup.
 */
async function handleCheckoutCompleted(session: any) {
  const sessionId = session.id as string
  const customerId = session.customer as string
  const subscriptionId = session.subscription as string | null
  const metadata = session.metadata || {}
  const practiceId = metadata.practice_id as string | undefined

  if (!practiceId) {
    console.warn(`â ï¸ checkout.session.completed without practice_id metadata (${sessionId})`)
    return
  }

  // --- 1. Load the practice ---
  const { data: practice, error: loadErr } = await supabaseAdmin
    .from('practices')
    .select('*')
    .eq('id', practiceId)
    .single()

  if (loadErr || !practice) {
    console.error(`â Could not load practice ${practiceId} for checkout completion:`, loadErr)
    return
  }

  // Idempotency: if already provisioned, don't run again.
  if (practice.status === 'active' && practice.phone_number && practice.vapi_assistant_id) {
    console.log(`â Practice ${practiceId} already provisioned â skipping`)
    return
  }

  let twilioNumberSid: string | null = null
  let twilioNumber: string | null = null
  let vapiAssistantId: string | null = null
  let vapiPhoneNumberId: string | null = null

  try {
    // --- 2. Purchase Twilio number ---
    console.log(`ð Purchasing Twilio number for ${practice.name} (state: ${practice.state})`)
    const purchased = await purchaseTwilioNumber({
      state: practice.state,
      friendlyName: `Harbor — ${practice.name}`,
      specificNumber: practice.selected_phone_number || undefined,
    })
    twilioNumberSid = purchased.sid
    twilioNumber = purchased.phoneNumber
    console.log(`â Twilio number purchased: ${twilioNumber} (${twilioNumberSid})`)

    // --- 3. Create Vapi assistant ---
    console.log(`ð¤ Creating Vapi assistant for ${practice.name}`)
    vapiAssistantId = await createVapiAssistant({
      id: practice.id,
      name: practice.name,
      providerName: practice.provider_name,
      aiName: practice.ai_name || 'Ellie',
      greeting: practice.greeting,
      specialties: practice.specialties,
      insuranceAccepted: practice.insurance_accepted,
      location: practice.location,
      telehealth: practice.telehealth,
      timezone: practice.timezone,
    })
    console.log(`â Vapi assistant created: ${vapiAssistantId}`)

    // --- 4. Link Twilio number to Vapi assistant ---
    console.log(`ð Linking Twilio number ${twilioNumber} to Vapi assistant ${vapiAssistantId}`)
    vapiPhoneNumberId = await linkVapiPhoneNumber({
      assistantId: vapiAssistantId,
      twilioPhoneNumber: twilioNumber,
      practiceName: practice.name,
    })
    console.log(`â Vapi phone number linked: ${vapiPhoneNumberId}`)

    // --- 5. Mark practice active + store provisioning metadata ---
    await supabaseAdmin
      .from('practices')
      .update({
        status: 'active',
        subscription_status: 'active',
        phone_number: twilioNumber,
        twilio_phone_sid: twilioNumberSid,
        vapi_assistant_id: vapiAssistantId,
        vapi_phone_number_id: vapiPhoneNumberId,
        stripe_subscription_id: subscriptionId,
        provisioned_at: new Date().toISOString(),
      })
      .eq('id', practiceId)

    console.log(`â Practice ${practiceId} fully provisioned`)

    // --- 6. Send welcome email ---
    await sendWelcomeEmail({
      to: practice.notification_email || practice.billing_email,
      practiceName: practice.name,
      aiName: practice.ai_name || 'Ellie',
      phoneNumber: twilioNumber,
      foundingMember: !!practice.founding_member,
    })
  } catch (err) {
    console.error(`â Provisioning failed for practice ${practiceId}:`, err)

    // Rollback best-effort â we want to avoid leaving orphaned resources,
    // but we do NOT delete the practice itself so the user can retry or
    // support can intervene.
    if (twilioNumberSid) {
      console.log(`â©ï¸ Releasing Twilio number ${twilioNumberSid}`)
      await releaseTwilioNumber(twilioNumberSid)
    }
    if (vapiAssistantId) {
      console.log(`â©ï¸ Deleting Vapi assistant ${vapiAssistantId}`)
      await deleteVapiAssistant(vapiAssistantId)
    }

    await supabaseAdmin
      .from('practices')
      .update({
        status: 'provisioning_failed',
        subscription_status: 'active', // they paid, so sub is active
        stripe_subscription_id: subscriptionId,
      })
      .eq('id', practiceId)
  }
}

async function handleSubscriptionCreated(subscription: any) {
  try {
    const customerId = subscription.customer
    const subscriptionId = subscription.id
    const status = subscription.status

    const { data: practice } = await supabaseAdmin
      .from('practices')
      .select('id')
      .eq('stripe_customer_id', customerId)
      .single()

    if (!practice) {
      console.warn('Could not find practice for subscription')
      return
    }

    await supabaseAdmin
      .from('practices')
      .update({
        stripe_subscription_id: subscriptionId,
        subscription_status: status === 'trialing' ? 'trialing' : 'active',
        updated_at: new Date().toISOString(),
      })
      .eq('id', practice.id)

    console.log(`â Subscription created for practice: ${practice.id}, status: ${status}`)
  } catch (error) {
    console.error('Error in handleSubscriptionCreated:', error)
  }
}

async function handleSubscriptionUpdated(subscription: any) {
  try {
    const customerId = subscription.customer
    const subscriptionId = subscription.id
    const status = subscription.status

    const { data: practice } = await supabaseAdmin
      .from('practices')
      .select('id')
      .eq('stripe_customer_id', customerId)
      .single()

    if (practice) {
      let newStatus = 'active'
      if (status === 'trialing') newStatus = 'trialing'
      if (status === 'past_due') newStatus = 'past_due'
      if (status === 'cancelled' || status === 'incomplete_expired') newStatus = 'cancelled'

      await supabaseAdmin
        .from('practices')
        .update({
          subscription_status: newStatus,
          updated_at: new Date().toISOString(),
        })
        .eq('id', practice.id)

      console.log(`â Subscription updated: ${subscriptionId}, ${status} -> ${newStatus}`)
    }
  } catch (error) {
    console.error('Error in handleSubscriptionUpdated:', error)
  }
}

async function handleSubscriptionDeleted(subscription: any) {
  try {
    const customerId = subscription.customer
    const subscriptionId = subscription.id

    const { data: practice } = await supabaseAdmin
      .from('practices')
      .select('id')
      .eq('stripe_customer_id', customerId)
      .single()

    if (practice) {
      await supabaseAdmin
        .from('practices')
        .update({
          subscription_status: 'cancelled',
          updated_at: new Date().toISOString(),
        })
        .eq('id', practice.id)

      console.log(`â ï¸ Subscription cancelled: ${subscriptionId} for ${practice.id}`)
    }
  } catch (error) {
    console.error('Error in handleSubscriptionDeleted:', error)
  }
}

async function handlePaymentSucceeded(invoice: any) {
  try {
    console.log(`â Payment succeeded: ${invoice.id}`)
  } catch (error) {
    console.error('Error in handlePaymentSucceeded:', error)
  }
}

async function handlePaymentFailed(invoice: any) {
  try {
    const customerId = invoice.customer
    const subscriptionId = invoice.subscription

    const { data: practice } = await supabaseAdmin
      .from('practices')
      .select('id')
      .eq('stripe_customer_id', customerId)
      .single()

    if (practice && subscriptionId) {
      await supabaseAdmin
        .from('practices')
        .update({
          subscription_status: 'past_due',
          updated_at: new Date().toISOString(),
        })
        .eq('id', practice.id)

      console.log(`â ï¸ Payment failed for invoice ${invoice.id}, marked past_due`)
    }
  } catch (error) {
    console.error('Error in handlePaymentFailed:', error)
  }
}
// Stripe webhook handler — expanded to handle checkout.session.completed,
// which triggers the full Twilio + Vapi provisioning pipeline for new
// practices on the card-upfront signup flow.

