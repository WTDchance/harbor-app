// app/api/reception/signup/route.ts
//
// W48 T4 — public signup specifically for Reception-only customers.
//
// Flow:
//   1. Validate body
//   2. Cognito AdminCreateUser (force-confirm + permanent password)
//   3. INSERT practices with product_tier='reception_only',
//      provisioning_state='active' (no Stripe gate for v1; Phase 2
//      adds Reception pricing + Stripe checkout)
//   4. INSERT users (cognito_sub → practice_id, role='owner')
//   5. Mint API key with default scopes
//   6. Return { practice_id, api_key_plaintext, signalwire_number,
//      retell_agent_id }
//
// Carrier provisioning (SignalWire + Retell) is intentionally NOT
// done here for v1 — keeps this PR focused on the schema + auth
// path. A follow-up PR factors out Wave 29's provisioning helper
// from the existing /api/signup flow into a reusable function and
// calls it after this signup completes. Until then, the response
// returns null for signalwire_number and retell_agent_id and
// operators provision them via the admin tools.

import { NextRequest, NextResponse } from 'next/server'
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  AdminGetUserCommand,
  AdminDeleteUserCommand,
} from '@aws-sdk/client-cognito-identity-provider'
import { pool } from '@/lib/aws/db'
import { auditSystemEvent } from '@/lib/aws/ehr/audit'
import { generateApiKey } from '@/lib/aws/reception/generate-api-key'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const COGNITO_REGION = process.env.COGNITO_REGION || 'us-east-1'
const COGNITO_USER_POOL_ID = process.env.COGNITO_USER_POOL_ID || ''

const DEFAULT_SCOPES = [
  'agents:read', 'agents:write',
  'calls:read',
  'appointments:read', 'appointments:write',
]

function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)
}

export async function POST(req: NextRequest) {
  try {
    if (!COGNITO_USER_POOL_ID) {
      return NextResponse.json({ error: 'cognito_not_configured' }, { status: 500 })
    }

    const body = await req.json().catch(() => null)
    if (!body) return NextResponse.json({ error: 'invalid_json' }, { status: 400 })

    const practiceName = String(body.practice_name || '').trim()
    const ownerEmail   = String(body.owner_email   || '').trim().toLowerCase()
    const ownerPhone   = body.owner_phone ? String(body.owner_phone).trim() : null
    const ownerPassword = String(body.owner_password || '')

    if (!practiceName) return NextResponse.json({ error: 'practice_name required' }, { status: 400 })
    if (!isValidEmail(ownerEmail)) return NextResponse.json({ error: 'owner_email invalid' }, { status: 400 })
    if (ownerPassword.length < 8) return NextResponse.json({ error: 'owner_password must be 8+ chars' }, { status: 400 })

    const cog = new CognitoIdentityProviderClient({ region: COGNITO_REGION })

    // Reject duplicate Cognito user.
    try {
      await cog.send(new AdminGetUserCommand({
        UserPoolId: COGNITO_USER_POOL_ID, Username: ownerEmail,
      }))
      return NextResponse.json(
        { error: 'An account with this email already exists. Try signing in.' },
        { status: 400 },
      )
    } catch { /* expected — UserNotFoundException */ }

    // Create Cognito user.
    let cognitoSub = ''
    try {
      const created = await cog.send(new AdminCreateUserCommand({
        UserPoolId: COGNITO_USER_POOL_ID,
        Username: ownerEmail,
        UserAttributes: [
          { Name: 'email', Value: ownerEmail },
          { Name: 'email_verified', Value: 'true' },
        ],
        MessageAction: 'SUPPRESS',
      }))
      cognitoSub = created.User?.Attributes?.find((a) => a.Name === 'sub')?.Value ?? ''
      if (!cognitoSub) throw new Error('Cognito returned no sub')
      await cog.send(new AdminSetUserPasswordCommand({
        UserPoolId: COGNITO_USER_POOL_ID,
        Username: ownerEmail,
        Password: ownerPassword,
        Permanent: true,
      }))
    } catch (err) {
      return NextResponse.json(
        { error: 'Failed to create account: ' + (err as Error).message },
        { status: 500 },
      )
    }

    // Practice + user transactionally.
    const client = await pool.connect()
    let practiceId = ''
    try {
      await client.query('BEGIN')
      const pIns = await client.query(
        `INSERT INTO practices
           (name, owner_email, billing_email, phone,
            product_tier, provisioning_state, subscription_status,
            timezone)
         VALUES ($1, $2, $2, $3, 'reception_only', 'active', 'active',
                 COALESCE($4, 'America/Los_Angeles'))
         RETURNING id`,
        [practiceName, ownerEmail, ownerPhone, body.timezone || null],
      )
      practiceId = pIns.rows[0].id

      await client.query(
        `INSERT INTO users (cognito_sub, email, full_name, practice_id, role)
         VALUES ($1, $2, $2, $3, 'owner')
         ON CONFLICT (cognito_sub) DO NOTHING`,
        [cognitoSub, ownerEmail, practiceId],
      )
      await client.query('COMMIT')
    } catch (err) {
      try { await client.query('ROLLBACK') } catch {}
      try {
        await cog.send(new AdminDeleteUserCommand({
          UserPoolId: COGNITO_USER_POOL_ID, Username: ownerEmail,
        }))
      } catch {}
      return NextResponse.json(
        { error: 'Failed to provision practice: ' + (err as Error).message },
        { status: 500 },
      )
    } finally {
      client.release()
    }

    // Mint the first API key with a sensible default scope set.
    const minted = await generateApiKey({
      practiceId,
      scopes: DEFAULT_SCOPES,
      createdByUserId: null,
    })

    await auditSystemEvent({
      action: 'reception.signup_completed' as any,
      practiceId,
      resourceType: 'practice',
      details: { has_phone: !!ownerPhone },
    })

    return NextResponse.json({
      practice_id: practiceId,
      api_key_plaintext: minted.plaintext,
      signalwire_number: null,    // Phase 2 — carrier provisioning
      retell_agent_id: null,      // Phase 2 — Retell agent creation
    })
  } catch (err) {
    console.error('[reception/signup] error:', (err as Error).message)
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
