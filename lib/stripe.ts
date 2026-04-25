// Stripe client and helpers for subscription billing
// Handles creating customers, subscriptions, and webhooks

import Stripe from 'stripe'

const stripeSecretKey = process.env.STRIPE_SECRET_KEY || ''

if (!stripeSecretKey) {
  console.warn('⚠️ Stripe secret key not configured. Billing operations will fail.')
}

// Initialize Stripe client
export const stripe = stripeSecretKey
  ? new Stripe(stripeSecretKey, { apiVersion: '2023-10-16' })
  : null

/**
 * Create a Stripe customer for a practice
 * Called during practice signup to set up billing
 *
 * @param email - Practice email
 * @param practiceName - Name of the practice
 * @returns Stripe customer ID
 */
export async function createStripeCustomer(
  email: string,
  practiceName: string
): Promise<string | null> {
  if (!stripe) {
    console.warn('⚠️ Stripe not configured - customer not created')
    return null
  }

  try {
    const customer = await stripe.customers.create({
      email: email,
      name: practiceName,
      metadata: {
        practiceName: practiceName,
      },
    })

    console.log(`✓ Stripe customer created: ${customer.id}`)
    return customer.id
  } catch (error) {
    console.error('Error creating Stripe customer:', error)
    throw error
  }
}

/**
 * Create a subscription for a practice
 * Called when practice signs up or changes plans
 *
 * @param customerId - Stripe customer ID
 * @param priceId - Stripe price ID (plan tier)
 * @param metadata - Additional metadata (practice_id, etc.)
 * @returns Stripe subscription ID
 */
export async function createSubscription(
  customerId: string,
  priceId: string,
  metadata?: Record<string, string>
): Promise<string | null> {
  if (!stripe) {
    console.warn('⚠️ Stripe not configured - subscription not created')
    return null
  }

  try {
    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: priceId }],
      payment_behavior: 'default_incomplete',
      expand: ['latest_invoice.payment_intent'],
      metadata: metadata || {},
    })

    console.log(`✓ Subscription created: ${subscription.id}`)
    return subscription.id
  } catch (error) {
    console.error('Error creating subscription:', error)
    throw error
  }
}

/**
 * Update a subscription's plan/price
 * Called when practice changes plan tiers
 *
 * @param subscriptionId - Stripe subscription ID
 * @param newPriceId - New Stripe price ID
 */
export async function updateSubscription(
  subscriptionId: string,
  newPriceId: string
): Promise<boolean> {
  if (!stripe) {
    console.warn('⚠️ Stripe not configured - subscription not updated')
    return false
  }

  try {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId)

    if (!subscription.items.data[0]) {
      console.error('Subscription has no items')
      return false
    }

    await stripe.subscriptions.update(subscriptionId, {
      items: [
        {
          id: subscription.items.data[0].id,
          price: newPriceId,
        },
      ],
    })

    console.log(`✓ Subscription updated: ${subscriptionId}`)
    return true
  } catch (error) {
    console.error('Error updating subscription:', error)
    throw error
  }
}

/**
 * Cancel a subscription
 * Called when practice cancels their account
 *
 * @param subscriptionId - Stripe subscription ID
 * @param atPeriodEnd - If true, cancel at end of billing period. If false, cancel immediately
 */
export async function cancelSubscription(
  subscriptionId: string,
  atPeriodEnd = true
): Promise<boolean> {
  if (!stripe) {
    console.warn('⚠️ Stripe not configured - subscription not cancelled')
    return false
  }

  try {
    await stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: atPeriodEnd,
    })

    console.log(`✓ Subscription cancelled: ${subscriptionId}`)
    return true
  } catch (error) {
    console.error('Error cancelling subscription:', error)
    throw error
  }
}

/**
 * Get subscription details
 *
 * @param subscriptionId - Stripe subscription ID
 */
export async function getSubscription(subscriptionId: string) {
  if (!stripe) {
    console.warn('⚠️ Stripe not configured')
    return null
  }

  try {
    return await stripe.subscriptions.retrieve(subscriptionId)
  } catch (error) {
    console.error('Error retrieving subscription:', error)
    return null
  }
}

/**
 * Get customer details
 *
 * @param customerId - Stripe customer ID
 */
export async function getCustomer(customerId: string) {
  if (!stripe) {
    console.warn('⚠️ Stripe not configured')
    return null
  }

  try {
    return await stripe.customers.retrieve(customerId)
  } catch (error) {
    console.error('Error retrieving customer:', error)
    return null
  }
}

/**
 * Create a payment intent for one-time payments
 * Used for add-ons or manual charges
 *
 * @param customerId - Stripe customer ID
 * @param amount - Amount in cents (e.g., 1000 = $10.00)
 * @param description - Description of the charge
 */
export async function createPaymentIntent(
  customerId: string,
  amount: number,
  description: string
): Promise<string | null> {
  if (!stripe) {
    console.warn('⚠️ Stripe not configured - payment intent not created')
    return null
  }

  try {
    const paymentIntent = await stripe.paymentIntents.create({
      customer: customerId,
      amount: amount,
      currency: 'usd',
      description: description,
    })

    return paymentIntent.client_secret
  } catch (error) {
    console.error('Error creating payment intent:', error)
    throw error
  }
}

/**
 * Verify a webhook signature from Stripe
 * Used in the webhook endpoint to ensure requests are from Stripe
 *
 * @param body - Raw request body
 * @param signature - Stripe-Signature header
 * @param secret - Webhook secret from Stripe dashboard
 */
export function verifyWebhookSignature(
  body: string,
  signature: string,
  secret: string
): Stripe.Event | null {
  if (!stripe) {
    console.warn('⚠️ Stripe not configured')
    return null
  }

  try {
    return stripe.webhooks.constructEvent(body, signature, secret)
  } catch (error) {
    console.error('Webhook signature verification failed:', error)
    return null
  }
}

/**
 * List all prices for a product
 * Used to show pricing plans during signup
 *
 * @param productId - Stripe product ID
 */
export async function listPrices(productId: string) {
  if (!stripe) {
    console.warn('⚠️ Stripe not configured')
    return []
  }

  try {
    const prices = await stripe.prices.list({
      product: productId,
    })

    return prices.data
  } catch (error) {
    console.error('Error listing prices:', error)
    return []
  }
}

/**
 * Check if Stripe is configured
 */
export function isStripeConfigured(): boolean {
  return !!stripe && !!stripeSecretKey
}
