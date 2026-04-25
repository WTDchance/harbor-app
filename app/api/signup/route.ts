// POST /api/signup
// Creates auth user + practice row in `pending_payment` state, then creates a
// Stripe Checkout Session and returns its URL. All Twilio / Vapi provisioning
// happens in the Stripe webhook once `checkout.session.completed` fires.
//
// This is the "card upfront, charge now" flow â no trial period.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { stripe } from '@/lib/stripe'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://harborreceptionist.com'
const FOUNDING_CAP = Number(process.env.FOUNDING_MEMBER_CAP || '20')
const STRIPE_PRICE_ID_FOUNDING = process.env.STRIPE_PRICE_ID_FOUNDING || ''
const STRIPE_PRICE_ID_REGULAR = process.env.STRIPE_PRICE_ID_REGULAR || process.env.STRIPE_PRICE_ID || ''

// Comp code: free forever, locked to a single email server-side.
// Provisioned in Stripe via /api/admin/create-mom-promo (one-time).
const MOM_PROMO_CODE = 'MOM-FREE'
const MOM_LOCKED_EMAIL = 'dr.tracewonser@gmail.com'

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

// Resolves a Stripe promotion code object by its human-readable code.
// Returns null if not found, expired, inactive, or fully redeemed.
async function resolveActivePromotionCode(code: string) {
  if (!stripe) return null
  const list = await stripe.promotionCodes.list({ code, limit: 1, active: true })
  const pc = list.data[0]
  if (!pc) return null
  if (pc.expires_at && pc.expires_at * 1000 < Date.now()) return null
  if (pc.max_redemptions != null && pc.times_redeemed >= pc.max_redemptions) return null
  return pc
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
      first_name,
      last_name,
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
      promo_code,
      selected_phone_number,
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
    const normalizedPromo = typeof promo_code === 'string' ? promo_code.trim().toUpperCase() : ''

    // --- Promo code validation (server-side, before any DB writes) ---
    // Currently the only supported code is MOM-FREE, which is locked to a
    // specific email. Any other non-empty code is rejected here so we don't
    // create dangling auth users / practice rows for an invalid promo.
    let resolvedPromo: Awaited<ReturnType<typeof resolveActivePromotionCode>> = null
    let isCompedSignup = false
    if (normalizedPromo) {
      if (normalizedPromo !== MOM_PROMO_CODE) {
        return NextResponse.json(
          { error: 'That promo code is not valid.' },
          { status: 400 }
        )
      }
      if (normalizedEmail !== MOM_LOCKED_EMAIL) {
        return NextResponse.json(
          { error: 'This promo code is not valid for that email address.' },
          { status: 400 }
        )
      }
      resolvedPromo = await resolveActivePromotionCode(MOM_PROMO_CODE)
      if (!resolvedPromo) {
        return NextResponse.json(
          {
            error:
              'This promo code has already been used or is no longer available. Contact support if you think this is a mistake.',
          },
          { status: 400 }
        )
      }
      isCompedSignup = true
    }

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
    // Comped signups don't burn a founding spot â we still set founding_member
    // false so the 20-spot landing-page counter stays accurate for paying users.
    const foundingUsed = await countFoundingMembers()
    const isFounding = !isCompedSignup && foundingUsed < FOUNDING_CAP
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
        subscription_status: isCompedSignup ? 'comped' : 'unpaid',
        founding_member: isFounding,
        comped: isCompedSignup,
        reminders_enabled: true,
        intake_enabled: true,
        emotional_support_enabled: true,
        insurance_accepted: insurance_accepted || [],
        provider_name,
        city: city || null,
        state: state || null,
        selected_phone_number: selected_phone_number || null,
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
      first_name: first_name || '',
      last_name: last_name || '',
      practice_id: practice.id,
      role: 'owner',
    })
    if (userError) {
      console.error('User record creation failed (non-fatal):', userError)
    }

    // --- LOCAL DEV BYPASS: skip Stripe entirely on localhost ---
    if (APP_URL.includes('localhost')) {
      // Mark practice as active immediately
      await supabaseAdmin
        .from('practices')
        .update({ status: 'active', subscription_status: 'dev_bypass' })
        .eq('id', practice.id)

      console.log(`[DEV] Signup created (Stripe bypassed): ${practice_name} (${practice.id})`)

      return NextResponse.json({
        success: true,
        practice_id: practice.id,
        founding_member: isFounding,
        comped: false,
        checkout_url: `${APP_URL}/dashboard`,
        session_id: 'dev_bypass',
      })
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
        comped: String(isCompedSignup),
      },
    })

    await supabaseAdmin
      .from('practices')
      .update({ stripe_customer_id: customer.id })
      .eq('id', practice.id)

    // --- 6. Create Stripe Checkout Session (charge-now subscription) ---
    // For comped signups: pre-attach the MOM-FREE promo code so the resolved
    // amount is $0, and tell Stripe not to collect a card unless required.
    // For everyone else: same as before (allow_promotion_codes lets users
    // type other promo codes at the Stripe-hosted checkout).
    const sessionParams: any = {
      customer: customer.id,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      // No trial â card-upfront, charge-now flow
      success_url: `${APP_URL}/signup/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${APP_URL}/signup?cancelled=1&practice_id=${practice.id}`,
      billing_address_collection: 'required',
      subscription_data: {
        metadata: {
          practice_id: practice.id,
          practice_name,
          founding_member: String(isFounding),
          comped: String(isCompedSignup),
        },
      },
      metadata: {
        practice_id: practice.id,
        auth_user_id: userId,
        founding_member: String(isFounding),
        comped: String(isCompedSignup),
        practice_state: state || '',
        practice_city: city || '',
        sms_consent: sms_consent ? 'true' : 'false',
        promo_code: isCompedSignup ? MOM_PROMO_CODE : '',
      },
    }

    if (isCompedSignup && resolvedPromo) {
      sessionParams.discounts = [{ promotion_code: resolvedPromo.id }]
      sessionParams.payment_method_collection = 'if_required'
    } else {
      sessionParams.allow_promotion_codes = true
    }

    const session = await stripe.checkout.sessions.create(sessionParams)

    // Persist the session id so the success page + webhook can reconcile.
    await supabaseAdmin
      .from('practices')
      .update({ stripe_checkout_session_id: session.id })
      .eq('id', practice.id)

    console.log(
      `Signup created: ${practice_name} (${practice.id}) â pending payment via ${session.id}` +
        (isCompedSignup ? ' [COMPED via MOM-FREE]' : '')
    )

    return NextResponse.json({
      success: true,
      practice_id: practice.id,
      founding_member: isFounding,
      comped: isCompedSignup,
      checkout_url: session.url,
      session_id: session.id,
    })
  } catch (error: any) {
    console.error('Signup error:', error)
    return NextResponse.json({ error: error.message || 'Signup failed' }, { status: 500 })
  }
}
