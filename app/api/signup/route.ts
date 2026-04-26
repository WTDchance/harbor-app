// app/api/signup/route.ts
//
// Wave 19 (AWS port). Therapist signup. Creates a Cognito user +
// practices row in pending_payment state, then mints a Stripe
// Checkout session and returns its URL. Carrier provisioning
// (Twilio + Vapi) does NOT happen here — Bucket 1 (Retell + SignalWire
// migration) owns that. The Stripe webhook (Wave 15) advances
// provisioning_state from 'pending_payment' → 'provisioning' →
// 'active'.
//
// Card-upfront, charge-now flow. No trial.
//
// Auth model:
//   1. Validate body (practice_name, provider_name, email, password).
//   2. Cognito AdminCreateUser (force-confirm email + set permanent
//      password so signup → first dashboard hit doesn't bounce through
//      a confirmation email).
//   3. INSERT practices in pending_payment state.
//   4. INSERT users (cognito_sub → practice_id, role='owner').
//   5. Stripe customer.create + checkout.sessions.create.
//   6. Return checkout URL.
//
// Audit captures provision.signup_received with email + payload hash
// and provision.created with practice_id once rows are written.

import { NextRequest, NextResponse } from 'next/server'
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  AdminGetUserCommand,
  AdminDeleteUserCommand,
} from '@aws-sdk/client-cognito-identity-provider'
import { pool } from '@/lib/aws/db'
import { stripe } from '@/lib/stripe'
import { auditSystemEvent } from '@/lib/aws/ehr/audit'
import { hashAdminPayload } from '@/lib/aws/admin/payload-hash'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://harborreceptionist.com'
const FOUNDING_CAP = Number(process.env.FOUNDING_MEMBER_CAP || '20')
const STRIPE_PRICE_ID_FOUNDING = process.env.STRIPE_PRICE_ID_FOUNDING || ''
const STRIPE_PRICE_ID_REGULAR =
  process.env.STRIPE_PRICE_ID_REGULAR || process.env.STRIPE_PRICE_ID || ''

const COGNITO_REGION = process.env.COGNITO_REGION || 'us-east-1'
const COGNITO_USER_POOL_ID = process.env.COGNITO_USER_POOL_ID || ''

// Comp code: free forever, locked to a single email server-side.
const MOM_PROMO_CODE = 'MOM-FREE'
const MOM_LOCKED_EMAIL = 'dr.tracewonser@gmail.com'

async function countFoundingMembers(): Promise<number> {
  try {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS c FROM practices
        WHERE founding_member = TRUE
          AND provisioning_state IN ('active','provisioning')`,
    )
    return rows[0]?.c ?? 0
  } catch {
    return 0
  }
}

async function signupsEnabled(): Promise<boolean> {
  try {
    const { rows } = await pool.query(
      `SELECT value FROM app_settings WHERE key = 'signups_enabled' LIMIT 1`,
    )
    if (rows.length === 0) return true
    const v = rows[0].value
    return v === true || v === 'true' || v === 1
  } catch (err) {
    console.error('[signup] failed to read signups_enabled:', (err as Error).message)
    return true
  }
}

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
        { status: 500 },
      )
    }
    if (!STRIPE_PRICE_ID_FOUNDING && !STRIPE_PRICE_ID_REGULAR) {
      return NextResponse.json(
        { error: 'Stripe price IDs not configured on the server.' },
        { status: 500 },
      )
    }
    if (!COGNITO_USER_POOL_ID) {
      return NextResponse.json(
        { error: 'COGNITO_USER_POOL_ID not configured' },
        { status: 500 },
      )
    }

    if (!(await signupsEnabled())) {
      return NextResponse.json(
        {
          error:
            'We are temporarily not accepting new signups while we finish onboarding our founding practices. Please check back soon or email hello@harborreceptionist.com to get on the waitlist.',
          code: 'signups_paused',
        },
        { status: 503 },
      )
    }

    const body = await req.json()
    const {
      practice_name,
      first_name,
      last_name,
      provider_name,
      city,
      state,
      email,
      password,
      ai_name,
      greeting,
      timezone,
      specialties,
      hours_json,
      tos_accepted,
      baa_acknowledged,
      sms_consent,
      promo_code,
      selected_phone_number,
      accepted_insurance,
    } = body

    if (!practice_name || !provider_name || !email || !password) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }
    if (typeof password !== 'string' || password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
    }
    if (!tos_accepted || !baa_acknowledged) {
      return NextResponse.json(
        { error: 'You must accept the Terms of Service and acknowledge the BAA to continue.' },
        { status: 400 },
      )
    }

    const normalizedEmail = String(email).trim().toLowerCase()
    const normalizedPromo = typeof promo_code === 'string' ? promo_code.trim().toUpperCase() : ''

    await auditSystemEvent({
      action: 'provision.signup_received',
      severity: 'info',
      details: {
        email: normalizedEmail,
        practice_name,
        founding_eligible: true,
        promo: normalizedPromo || null,
        payload_hash: hashAdminPayload({ ...body, password: undefined }),
      },
    })

    // --- Promo code validation ---
    let resolvedPromo: Awaited<ReturnType<typeof resolveActivePromotionCode>> = null
    let isCompedSignup = false
    if (normalizedPromo) {
      if (normalizedPromo !== MOM_PROMO_CODE) {
        return NextResponse.json({ error: 'That promo code is not valid.' }, { status: 400 })
      }
      if (normalizedEmail !== MOM_LOCKED_EMAIL) {
        return NextResponse.json(
          { error: 'This promo code is not valid for that email address.' },
          { status: 400 },
        )
      }
      resolvedPromo = await resolveActivePromotionCode(MOM_PROMO_CODE)
      if (!resolvedPromo) {
        return NextResponse.json(
          { error: 'This promo code has already been used or is no longer available.' },
          { status: 400 },
        )
      }
      isCompedSignup = true
    }

    const aiName = ai_name || 'Ellie'
    const ellieGreeting =
      greeting ||
      `Thank you for calling ${practice_name}. This is ${aiName}, the AI receptionist for ${provider_name}. How can I help you today?`
    const finalHoursJson =
      hours_json || {
        monday: { enabled: true, openTime: '09:00', closeTime: '17:00' },
        tuesday: { enabled: true, openTime: '09:00', closeTime: '17:00' },
        wednesday: { enabled: true, openTime: '09:00', closeTime: '17:00' },
        thursday: { enabled: true, openTime: '09:00', closeTime: '17:00' },
        friday: { enabled: true, openTime: '09:00', closeTime: '17:00' },
        saturday: { enabled: false, openTime: '09:00', closeTime: '13:00' },
        sunday: { enabled: false, openTime: '09:00', closeTime: '13:00' },
      }

    const foundingUsed = await countFoundingMembers()
    const isFounding = !isCompedSignup && foundingUsed < FOUNDING_CAP
    const priceId =
      isFounding && STRIPE_PRICE_ID_FOUNDING ? STRIPE_PRICE_ID_FOUNDING : STRIPE_PRICE_ID_REGULAR
    if (!priceId) {
      return NextResponse.json({ error: 'No price configured for this tier.' }, { status: 500 })
    }

    // --- Cognito user creation ---
    const cog = new CognitoIdentityProviderClient({ region: COGNITO_REGION })

    // Check existing
    try {
      await cog.send(
        new AdminGetUserCommand({ UserPoolId: COGNITO_USER_POOL_ID, Username: normalizedEmail }),
      )
      return NextResponse.json(
        { error: 'An account with this email already exists. Try signing in.' },
        { status: 400 },
      )
    } catch {
      // expected — UserNotFoundException
    }

    let cognitoSub = ''
    try {
      const created = await cog.send(
        new AdminCreateUserCommand({
          UserPoolId: COGNITO_USER_POOL_ID,
          Username: normalizedEmail,
          UserAttributes: [
            { Name: 'email', Value: normalizedEmail },
            { Name: 'email_verified', Value: 'true' },
          ],
          MessageAction: 'SUPPRESS', // don't send Cognito's invite email
        }),
      )
      cognitoSub = created.User?.Attributes?.find((a) => a.Name === 'sub')?.Value ?? ''
      if (!cognitoSub) throw new Error('Cognito returned no sub')
      // Set the password permanent so login works without FORCE_CHANGE flow
      await cog.send(
        new AdminSetUserPasswordCommand({
          UserPoolId: COGNITO_USER_POOL_ID,
          Username: normalizedEmail,
          Password: password,
          Permanent: true,
        }),
      )
    } catch (err) {
      return NextResponse.json(
        { error: 'Failed to create account: ' + (err as Error).message },
        { status: 500 },
      )
    }

    // --- Insert practice + user transactionally ---
    const client = await pool.connect()
    let practiceId = ''
    try {
      await client.query('BEGIN')
      const pIns = await client.query(
        `INSERT INTO practices (
            name, ai_name, owner_email, billing_email, location, phone,
            specialties, hours, timezone, greeting, provisioning_state,
            subscription_status, founding_member, comped,
            accepted_insurance, provider_name, city, state, selected_phone_number
         ) VALUES (
            $1, $2, $3, $3, $4, NULL,
            $5::text[], $6::jsonb, $7, $8, 'pending_payment',
            $9, $10, $11,
            $12::text[], $13, $14, $15, $16
         ) RETURNING id`,
        [
          practice_name,
          aiName,
          normalizedEmail,
          [city, state].filter(Boolean).join(', ') || null,
          Array.isArray(specialties) ? specialties : [],
          JSON.stringify(finalHoursJson),
          timezone || 'America/Los_Angeles',
          ellieGreeting,
          isCompedSignup ? 'comped' : 'unpaid',
          isFounding,
          isCompedSignup,
          Array.isArray(accepted_insurance) ? accepted_insurance : [],
          provider_name,
          city || null,
          state || null,
          selected_phone_number || null,
        ],
      )
      practiceId = pIns.rows[0].id

      const fullName = [first_name, last_name].filter(Boolean).join(' ').trim() || provider_name
      await client.query(
        `INSERT INTO users (cognito_sub, email, full_name, practice_id, role)
         VALUES ($1, $2, $3, $4, 'owner')
         ON CONFLICT (cognito_sub) DO NOTHING`,
        [cognitoSub, normalizedEmail, fullName, practiceId],
      )

      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      // Roll back the Cognito user too so a retry doesn't 400 on duplicate.
      try {
        await cog.send(
          new AdminDeleteUserCommand({
            UserPoolId: COGNITO_USER_POOL_ID,
            Username: normalizedEmail,
          }),
        )
      } catch {
        /* best effort */
      }
      return NextResponse.json(
        { error: 'Failed to create practice: ' + (err as Error).message },
        { status: 500 },
      )
    } finally {
      client.release()
    }

    // --- LOCAL DEV BYPASS: skip Stripe entirely on localhost ---
    if (APP_URL.includes('localhost')) {
      await pool.query(
        `UPDATE practices
            SET provisioning_state = 'active',
                subscription_status = 'dev_bypass'
          WHERE id = $1`,
        [practiceId],
      )
      await auditSystemEvent({
        action: 'provision.created',
        severity: 'info',
        practiceId,
        details: { mode: 'dev_bypass', email: normalizedEmail },
      })
      return NextResponse.json({
        success: true,
        practice_id: practiceId,
        founding_member: isFounding,
        comped: false,
        checkout_url: `${APP_URL}/dashboard`,
        session_id: 'dev_bypass',
      })
    }

    // --- Stripe customer + checkout ---
    const customer = await stripe.customers.create({
      email: normalizedEmail,
      name: practice_name,
      metadata: {
        practice_id: practiceId,
        practice_name,
        provider_name,
        founding_member: String(isFounding),
        comped: String(isCompedSignup),
      },
    })

    await pool.query(
      `UPDATE practices SET stripe_customer_id = $1 WHERE id = $2`,
      [customer.id, practiceId],
    )

    const sessionParams: any = {
      customer: customer.id,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${APP_URL}/signup/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${APP_URL}/signup?cancelled=1&practice_id=${practiceId}`,
      billing_address_collection: 'required',
      subscription_data: {
        metadata: {
          practice_id: practiceId,
          practice_name,
          founding_member: String(isFounding),
          comped: String(isCompedSignup),
        },
      },
      metadata: {
        practice_id: practiceId,
        cognito_sub: cognitoSub,
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
    await pool.query(
      `UPDATE practices SET stripe_checkout_session_id = $1 WHERE id = $2`,
      [session.id, practiceId],
    )

    await auditSystemEvent({
      action: 'provision.created',
      severity: 'info',
      practiceId,
      details: {
        email: normalizedEmail,
        founding_member: isFounding,
        comped: isCompedSignup,
        stripe_customer_id: customer.id,
        stripe_checkout_session_id: session.id,
      },
    })

    return NextResponse.json({
      success: true,
      practice_id: practiceId,
      founding_member: isFounding,
      comped: isCompedSignup,
      checkout_url: session.url,
      session_id: session.id,
    })
  } catch (err) {
    console.error('Signup error:', err)
    return NextResponse.json({ error: (err as Error).message || 'Signup failed' }, { status: 500 })
  }
}
