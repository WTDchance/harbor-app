// app/api/provision/route.ts
//
// Wave 19 (AWS port). Multi-therapist provisioning. Creates a new
// practices row directly (admin tooling — used to seed practices that
// don't go through the public /api/signup checkout flow).
//
// Carrier provisioning (Vapi assistant + Twilio number) is CARVED OUT
// here. The legacy version did the Vapi assistant create + cleanup-on-
// failure inline; that lives in Bucket 1 (Retell + SignalWire
// migration). For now we just write the practices row in
// 'pending_payment' state so a follow-up Bucket 1 step can attach the
// carrier identifiers.
//
// Auth: requireAdminSession() — Cognito session must match
// ADMIN_EMAIL allowlist. (Legacy had no auth here — that was a
// preexisting bug we close on the AWS port.)
//
// Audit captures admin email + new practice_id + payload hash.

import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/aws/db'
import { requireAdminSession } from '@/lib/aws/api-auth'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
import { hashAdminPayload } from '@/lib/aws/admin/payload-hash'

interface ProvisionRequest {
  therapist_name: string
  practice_name: string
  notification_email?: string  // legacy alias
  owner_email?: string
  phone_number?: string
  therapist_phone?: string
  ai_name?: string
  specialties?: string[]
  hours_json?: Record<string, unknown>
  location?: string
  telehealth?: boolean
  accepted_insurance?: string[]
  greeting?: string
  timezone?: string
  provider_name?: string
}

export async function POST(req: NextRequest) {
  const ctx = await requireAdminSession()
  if (ctx instanceof NextResponse) return ctx

  let body: ProvisionRequest
  try {
    body = (await req.json()) as ProvisionRequest
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const ownerEmail = (body.owner_email || body.notification_email || '').toLowerCase().trim()
  const { therapist_name, practice_name, ai_name, phone_number } = body

  if (!therapist_name || !practice_name || !ownerEmail) {
    return NextResponse.json(
      {
        error:
          'Missing required fields: therapist_name, practice_name, owner_email (or notification_email)',
      },
      { status: 400 },
    )
  }

  const aiName = ai_name || 'Ellie'

  const insertRes = await pool.query(
    `INSERT INTO practices (
        name, ai_name, owner_email, billing_email, phone, location,
        provider_name, specialties, hours, timezone, greeting,
        provisioning_state, accepted_insurance
     ) VALUES (
        $1, $2, $3, $3, $4, $5,
        $6, $7::text[], $8::jsonb, $9, $10,
        'pending_payment', $11::text[]
     ) RETURNING id, name, ai_name, phone, owner_email, provisioning_state`,
    [
      practice_name,
      aiName,
      ownerEmail,
      phone_number || null,
      body.location || null,
      body.provider_name || therapist_name,
      Array.isArray(body.specialties) ? body.specialties : [],
      JSON.stringify(body.hours_json || {}),
      body.timezone || 'America/Los_Angeles',
      body.greeting || `Hi, thank you for calling ${practice_name}! This is ${aiName}. How can I help you today?`,
      Array.isArray(body.accepted_insurance) ? body.accepted_insurance : [],
    ],
  )

  const practice = insertRes.rows[0]

  await auditEhrAccess({
    ctx,
    action: 'provision.created',
    resourceType: 'practice',
    resourceId: practice.id,
    details: {
      admin_email: ctx.session.email,
      target_practice_id: practice.id,
      payload_hash: hashAdminPayload(body),
      mode: 'admin_provision',
      carrier_pending: true,
    },
  })

  return NextResponse.json(
    {
      success: true,
      practice,
      next_steps: [
        'Carrier provisioning (Vapi assistant + phone number) is on the Bucket 1 carrier-swap track. ' +
          'Use the Retell/SignalWire admin tooling once that lands to attach carrier identifiers ' +
          'and flip provisioning_state from pending_payment → active.',
        phone_number
          ? `Existing number ${phone_number} stored on the practice row; carrier link still pending.`
          : 'No phone number provided; carrier-side number purchase will happen during Bucket 1 wiring.',
      ],
    },
    { status: 201 },
  )
}

export async function GET() {
  return NextResponse.json({
    endpoint: 'POST /api/provision',
    description:
      'Admin-only: provision a new practice row. Carrier provisioning is deferred to Bucket 1 (Retell + SignalWire migration).',
    required_fields: ['therapist_name', 'practice_name', 'owner_email'],
    optional_fields: [
      'phone_number',
      'ai_name',
      'specialties',
      'hours_json',
      'location',
      'telehealth',
      'accepted_insurance',
      'greeting',
      'timezone',
      'provider_name',
    ],
    auth: 'Cognito admin session (requireAdminSession)',
  })
}
