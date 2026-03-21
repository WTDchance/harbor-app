// POST /api/billing/create-checkout
// Creates a Stripe Checkout session for $499/month subscription
// Body: { practice_id, email, practice_name }

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { stripe } from '@/lib/stripe'

const HARBOR_PRICE_ID = process.env.STRIPE_PRICE_ID
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

export async function POST(request: NextRequest) {
  try {
    const { practice_id, email, practice_name } = await request.json()

    if (!practice_id || !email || !practice_name) {
      return NextResponse.json(
        { error: 'Missing required fields: practice_id, email, practice_name' },
        { status: 400 }
      )
    }

    if (!stripe) {
      return NextResponse.json(
        { error: 'Stripe not configured' },
        { status: 500 }
      )
    }

    if (!HARBOR_PRICE_ID) {
      return NextResponse.json(
        { error: 'Harbor price ID not configured' },
        { status: 500 }
      )
    }

    // Find or create Stripe customer
    const { data: practice } = await supabaseAdmin
      .from('practices')
      .select('stripe_customer_id')
      .eq('id', practice_id)
      .single()

    let customerId = practice?.stripe_customer_id

    if (!customerId) {
      // Create new Stripe customer
      const customer = await stripe.customers.create({
        email,
        name: practice_name,
        metadata: {
          practice_id,
          practice_name,
        },
      })
      customerId = customer.id

      // Update practice with customer ID
      await supabaseAdmin
        .from('practices')
        .update({
          stripe_customer_id: customerId,
          billing_email: email,
        })
        .eq('id', practice_id)

      console.log(`✓ Created Stripe customer: ${customerId} for practice ${practice_id}`)
    } else {
      console.log(`✓ Using existing Stripe customer: ${customerId}`)
    }

    // Create Checkout session with 14-day trial
    const checkoutSession = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      success_url: `${APP_URL}/dashboard/billing?success=true`,
      cancel_url: `${APP_URL}/onboard?cancelled=true`,
      subscription_data: {
        trial_period_days: 14,
        metadata: {
          practice_id,
        },
      },
      line_items: [
        {
          price: HARBOR_PRICE_ID,
          quantity: 1,
        },
      ],
    })

    console.log(`✓ Checkout session created: ${checkoutSession.id}`)

    return NextResponse.json({
      url: checkoutSession.url,
    })
  } catch (error) {
    console.error('Error creating checkout session:', error)
    return NextResponse.json(
      { error: 'Failed to create checkout session' },
      { status: 500 }
    )
  }
}

export async function GET() {
  return NextResponse.json({
    endpoint: 'POST /api/billing/create-checkout',
    description: 'Create a Stripe Checkout session for subscription',
    required_fields: ['practice_id', 'email', 'practice_name'],
  })
}
