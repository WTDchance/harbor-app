// Stripe webhook handler
// Handles subscription events: created, updated, deleted

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { verifyWebhookSignature } from '@/lib/stripe'

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || ''

/**
 * POST /api/stripe/webhook
 * Handles Stripe webhook events
 * Events we care about:
 * - customer.subscription.created
 * - customer.subscription.updated
 * - customer.subscription.deleted
 */
export async function POST(request: NextRequest) {
  try {
    const signature = request.headers.get('stripe-signature')
    if (!signature) {
      console.warn('⚠️ No Stripe signature header')
      return NextResponse.json(
        { error: 'No signature' },
        { status: 400 }
      )
    }

    // Get raw body as string for signature verification
    const body = await request.text()

    // Verify webhook signature
    const event = verifyWebhookSignature(body, signature, webhookSecret)

    if (!event) {
      console.warn('❌ Invalid Stripe signature')
      return NextResponse.json(
        { error: 'Invalid signature' },
        { status: 403 }
      )
    }

    console.log(`💳 Stripe webhook: ${event.type}`)

    // Handle different event types
    switch (event.type) {
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
    console.error('❌ Stripe webhook error:', error)
    return NextResponse.json(
      { error: 'Webhook processing failed' },
      { status: 500 }
    )
  }
}

/**
 * Handle subscription created event
 * Update practice with subscription ID and active status
 */
async function handleSubscriptionCreated(subscription: any) {
  try {
    const customerId = subscription.customer
    const subscriptionId = subscription.id
    const status = subscription.status

    // Find practice by Stripe customer ID
    const { data: practice, error } = await supabaseAdmin
      .from('practices')
      .select('id')
      .eq('stripe_customer_id', customerId)
      .single()

    if (error || !practice) {
      console.warn('Could not find practice for subscription')
      return
    }

    // Update practice with subscription ID and status
    await supabaseAdmin
      .from('practices')
      .update({
        stripe_subscription_id: subscriptionId,
        subscription_status: status === 'trialing' ? 'trialing' : 'active',
        updated_at: new Date().toISOString(),
      })
      .eq('id', practice.id)

    console.log(`✓ Subscription created for practice: ${practice.id}, status: ${status}`)
  } catch (error) {
    console.error('Error in handleSubscriptionCreated:', error)
  }
}

/**
 * Handle subscription updated event
 * Could indicate plan change or cancellation
 */
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
      // Map Stripe status to Harbor subscription status
      let newStatus = 'active'
      if (status === 'trialing') newStatus = 'trialing'
      if (status === 'past_due') newStatus = 'past_due'
      if (status === 'cancelled' || status === 'incomplete_expired') newStatus = 'cancelled'

      // Update practice status
      await supabaseAdmin
        .from('practices')
        .update({
          subscription_status: newStatus,
          updated_at: new Date().toISOString(),
        })
        .eq('id', practice.id)

      console.log(`✓ Subscription updated: ${subscriptionId}, status: ${status} -> ${newStatus}`)
    }
  } catch (error) {
    console.error('Error in handleSubscriptionUpdated:', error)
  }
}

/**
 * Handle subscription deleted event
 * Practice cancelled their subscription
 */
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
      // Update practice status to cancelled
      await supabaseAdmin
        .from('practices')
        .update({
          subscription_status: 'cancelled',
          updated_at: new Date().toISOString(),
        })
        .eq('id', practice.id)

      console.log(`⚠️ Subscription cancelled: ${subscriptionId} for practice ${practice.id}`)
    }
  } catch (error) {
    console.error('Error in handleSubscriptionDeleted:', error)
  }
}

/**
 * Handle successful payment
 */
async function handlePaymentSucceeded(invoice: any) {
  try {
    console.log(`✓ Payment succeeded: ${invoice.id}`)
    // Could send receipt email here
  } catch (error) {
    console.error('Error in handlePaymentSucceeded:', error)
  }
}

/**
 * Handle failed payment
 */
async function handlePaymentFailed(invoice: any) {
  try {
    const customerId = invoice.customer
    const subscriptionId = invoice.subscription

    // Find practice by customer ID
    const { data: practice } = await supabaseAdmin
      .from('practices')
      .select('id')
      .eq('stripe_customer_id', customerId)
      .single()

    if (practice && subscriptionId) {
      // Update subscription status to past_due
      await supabaseAdmin
        .from('practices')
        .update({
          subscription_status: 'past_due',
          updated_at: new Date().toISOString(),
        })
        .eq('id', practice.id)

      console.log(`⚠️ Payment failed for invoice ${invoice.id}, marked subscription as past_due`)
    }
  } catch (error) {
    console.error('Error in handlePaymentFailed:', error)
  }
}
