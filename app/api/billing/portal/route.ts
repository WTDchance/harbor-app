// POST /api/billing/portal
// Creates a Stripe Customer Portal session for managing billing
// Fetches practice by user email, gets stripe_customer_id

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { stripe } from '@/lib/stripe'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json()

    if (!email) {
      return NextResponse.json(
        { error: 'Missing required field: email' },
        { status: 400 }
      )
    }

    if (!stripe) {
      return NextResponse.json(
        { error: 'Stripe not configured' },
        { status: 500 }
      )
    }

    // Find practice by email
    const { data: practice, error } = await supabaseAdmin
      .from('practices')
      .select('id, stripe_customer_id')
      .eq('notification_email', email)
      .single()

    if (error || !practice) {
      return NextResponse.json(
        { error: 'Practice not found' },
        { status: 404 }
      )
    }

    if (!practice.stripe_customer_id) {
      return NextResponse.json(
        { error: 'No Stripe customer found for this practice' },
        { status: 400 }
      )
    }

    // Create Customer Portal session
    const session = await stripe.billingPortal.sessions.create({
      customer: practice.stripe_customer_id,
      return_url: `${APP_URL}/dashboard/billing`,
    })

    console.log(`✓ Billing portal session created: ${session.id}`)

    return NextResponse.json({
      url: session.url,
    })
  } catch (error) {
    console.error('Error creating billing portal session:', error)
    return NextResponse.json(
      { error: 'Failed to create billing portal session' },
      { status: 500 }
    )
  }
}

export async function GET() {
  return NextResponse.json({
    endpoint: 'POST /api/billing/portal',
    description: 'Create a Stripe Customer Portal session',
    required_fields: ['email'],
  })
}
