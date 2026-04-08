// POST /api/signup
// Creates auth user + practice row in `pending_payment` state, then creates a
// Stripe Checkout Session and returns its URL. All Twilio / Vapi provisioning
// happens in the Stripe webhook once `checkout.session.completed` fires.
//
// This is the "card upfront, charge now" flow — no trial period.

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { stripe } from '@/lib/stripe'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://harborreceptionist.com'
const FOUNDING_CAP = Number(process.env.FOUNDING_MEMBER_CAP || '20')
const STRIPE_PRICE_ID_FOUNDING = process.env.STRIPE_PRICE_ID_FOUNDING || ''
const STRIPE_PRICE_ID_REGULAR =
  process.env.STRIPE_PRICE_ID_REGULAR || process.env.STRIPE_PRICE_ID || ''

async function countFoundingMembers(): Promise<number> {
  const { count } = await supabaseAdmin
    .from('practices')
    .select('id', { count: 'exact', head: true })
    .eq('founding_member', true)
    .in('status', ['active', 'trial'])
  return count || 0
}

async function signupsEnabled(): Promise<boolean> {
  try {
    const { data } = await supabaseAdmin
      .from('app_settings')
      .select('value')
      .eq('key', 'signups_enabled')
      .maybeSingle()
    if (!data) return true // default open if setting missing
    const v = data.value
    return v === true || v === 'true' || v === 1
  } catch (e) {
    console.error('[signup] failed to read signups_enabled, defaulting to enabled:', e)
    return true
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!stripe) {
      return NextResponse.json(
        { error: 'Billing is not configured. Please contact support.' },
        { status: 500 }
      )
    }
    if (!STRIPE_PRICE_ID_FOUNDING && !STRIPE_PRICE_ID_REGULAR) {
      return NextResponse.json(
        { error: 'Stripe price IDs not configured on the server.' },
        { status: 500 }
      )
    }

    // --- 0. Kill switch check ---
    if (!(await signupsEnabled())) {
      return NextResponse.json(
        {
          error:
            'We are temporarily not accepting new signups while we finish onboarding our founding practices. Please check back soon or email hello@harborreceptionist.com to get on the waitlist.',
          code: 'signups_paused',
        },
        { status: 503 }
      )
    }

    const body = await req.json()
    const {
      practice_name,
      provider_name,
      phone,
      city,
      state,
      email,
      password,
      ai_name,
      greeting,
      timezone,
      telehealth,
      accepting_new_patients,
      specialties,
      insurance_accepted,
      hours_json,
      tos_accepted,
      baa_acknowledged,
      sms_consent,
    } = body

    // --- Basic validation ---
    if (!practice_name || !provider_name || !email || !password) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }
    if (typeof password !== 'string' || password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
    }
    if (!tos_accepted || !baa_acknowledged) {
      return NextResponse.json(
        { error: 'You must accept the Terms of Service and acknowledge the BAA to continue.' },
        { status: 400 }
      )
    }

    const normalizedEmail = String(email).trim().toLowerCase()
    const aiName = ai_name || 'Ellie'
    const ellieGreeting =
      greeting ||
      `Thank you for calling ${practice_name}. This is ${aiName}, the AI receptionist for ${provider_name}. How can I help you today?`
    const location = [city, state].filter(Boolean).join(', ') || null

    const finalHoursJson = hours_json || {
      monday: { enabled: true, openTime: '09:00', closeTime: '17:00' },
      tuesday: { enabled: true, openTime: '09:00', closeTime: '17:00' },
      wednesday: { enabled: true, openTime: '09:00', closeTime: '17:00' },
      thursday: { enabled: true, openTime: '09:00', closeTime: '17:00' },
      friday: { enabled: true, openTime: '09:00', closeTime: '17:00' },
      saturday: { enabled: false, openTime: '09:00', closeTime: '13:00' },
      sunday: { enabled: false, openTime: '09:00', closeTime: '13:00' },
    }

    // --- 1. Founding member check ---
    const foundingUsed = await countFoundingMembers()
    const isFounding = foundingUsed < FOUNDING_CAP
    const priceId =
      isFounding && STRIPE_PRICE_ID_FOUNDING ? STRIPE_PRICE_ID_FOUNDING : STRIPE_PRICE_ID_REGULAR

    if (!priceId) {
      return NextResponse.json({ error: 'No price configured for this tier.' }, { status: 500 })
    }

    // --- 2. Create auth user ---
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: normalizedEmail,
      password,
      email_confirm: true,
    })

    if (authError || !authData.user) {
      const msg = authError?.message || 'Failed to create account'
      if (
        msg.toLowerCase().includes('already been registered') ||
        msg.toLowerCase().includes('already registered')
      ) {
        return NextResponse.json(
          { error: 'An account with this email already exists. Try signing in.' },
          { status: 400 }
        )
      }
      return NextResponse.json({ error: msg }, { status: 500 })
    }

    const userId = authData.user.id

    // --- 3. Create practice row (pending_payment) ---
    const { data: practice, error: practiceError } = await supabaseAdmin
      .from('practices')
      .insert({
        name: practice_name,
        ai_name: aiName,
        phone_number: null, // assigned by webhook after Twilio purchase
        location,
        specialties: specialties || [],
        telehealth: telehealth !== false,
        accepting_new_patients: accepting_new_patients !== false,
        hours_json: finalHoursJson,
        timezone: timezone || 'America/Los_Angeles',
        greeting: ellieGreeting,
        auth_user_id: userId,
        notification_email: normalizedEmail,
        billing_email: normalizedEmail,
        status: 'pending_payment',
        subscription_status: 'unpaid',
        founding_member: isFounding,
        reminders_enabled: true,
        intake_enabled: true,
        emotional_support_enabled: true,
        insurance_accepted: insurance_accepted || [],
        provider_name,
        city: city || null,
        state: state || null,
        specialty:
          specialties && specialties[0]
            ? specialties[0].toLowerCase().replace(/\s+/g, '_')
            : 'general',
      })
      .select()
      .single()

    if (practiceError || !practice) {
      console.error('Practice creation failed:', practiceError)
      await supabaseAdmin.auth.admin.deleteUser(userId)
      return NextResponse.json(
        { error: practiceError?.message || 'Failed to create practice' },
        { status: 500 }
      )
    }

    // --- 4. Link auth user to practice ---
    const { error: userError } = await supabaseAdmin.from('users').insert({
      id: userId,
      email: normalizedEmail,
      practice_id: practice.id,
      role: 'owner',
    })

    if (userError) {
      console.error('User record creation failed (non-fatal):', userError)
    }

    // --- 5. Create (or reuse) Stripe customer ---
    const customer = await stripe.customers.create({
      email: normalizedEmail,
      name: practice_name,
      metadata: {
        practice_id: practice.id,
        practice_name,
        provider_name,
        founding_member: String(isFounding),
      },
    })

    await supabaseAdmin
      .from('practices')
      .update({ stripe_customer_id: customer.id })
      .eq('id', practice.id)

    // --- 6. Create Stripe Checkout Session (charge-now subscription) ---
    const session = await stripe.checkout.sessions.create({
      customer: customer.id,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      // No trial — card-upfront, charge-now flow
      success_url: `${APP_URL}/signup/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${APP_URL}/signup?cancelled=1&practice_id=${practice.id}`,
      allow_promotion_codes: true,
      billing_address_collection: 'required',
      subscription_data: {
        metadata: {
          practice_id: practice.id,
          practice_name,
          founding_member: String(isFounding),
        },
      },
      metadata: {
        practice_id: practice.id,
        auth_user_id: userId,
        founding_member: String(isFounding),
        practice_state: state || '',
        practice_city: city || '',
        sms_consent: sms_consent ? 'true' : 'false',
      },
    })

    // Persist the session id so the success page + webhook can reconcile.
    await supabaseAdmin
      .from('practices')
      .update({ stripe_checkout_session_id: session.id })
      .eq('id', practice.id)

    console.log(
      `Signup created: ${practice_name} (${practice.id}) — pending payment via ${session.id}`
    )

    return NextResponse.json({
      success: true,
      practice_id: practice.id,
      founding_member: isFounding,
      checkout_url: session.url,
      session_id: session.id,
    })
  } catch (error: any) {
    console.error('Signup error:', error)
    return NextResponse.json({ error: error.message || 'Signup failed' }, { status: 500 })
  }
}

