// FILE: app/api/admin/practices/route.ts
// Admin practice-management endpoint. Lets us triage the practices table and
// destructively clean up rows that never completed signup.
//
// Auth: Bearer ${CRON_SECRET}
//
// GET  /api/admin/practices
//   → { total, practices: [...] } — every practice with identifying fields
//     (name, status, stripe/vapi/twilio ids, provisioning flags, created_at)
//
// DELETE /api/admin/practices?practice_id=<uuid>&confirm=<uuid>
//                            [&release_external=false]
//   → Cascade-deletes the practice. `confirm` must exactly equal practice_id
//     as a typo guard. Child rows (users, patients, appointments, call_logs,
//     calendar_connections, etc.) cascade via ON DELETE CASCADE FKs.
//
//     When release_external is not "false", we also best-effort:
//       - DELETE the Vapi assistant (via deleteVapiAssistant)
//       - RELEASE the Twilio phone number (via releaseTwilioNumber)
//     The Stripe subscription is NEVER auto-cancelled — we surface it in the
//     response so the caller can revoke manually.
//
//     Response: { ok, deleted_practice, externalCleanup: { vapi_assistant?,
//                 twilio_number?, stripe_subscription? } }

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { deleteVapiAssistant } from '@/lib/vapi-provision'
import { releaseTwilioNumber } from '@/lib/twilio-provision'

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') || ''
  const expected = `Bearer ${process.env.CRON_SECRET || ''}`
  if (!process.env.CRON_SECRET || auth !== expected) return unauthorized()

  const { data: practices, error } = await supabaseAdmin
    .from('practices')
    .select(
      'id, name, therapist_name, notification_email, phone_number, owner_phone, ' +
        'status, subscription_status, founding_member, vapi_assistant_id, ' +
        'vapi_phone_number_id, twilio_phone_sid, stripe_customer_id, ' +
        'stripe_subscription_id, provisioning_error, provisioning_attempts, ' +
        'provisioned_at, created_at'
    )
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    total: practices?.length || 0,
    practices: practices || [],
  })
}

export async function DELETE(req: NextRequest) {
  const auth = req.headers.get('authorization') || ''
  const expected = `Bearer ${process.env.CRON_SECRET || ''}`
  if (!process.env.CRON_SECRET || auth !== expected) return unauthorized()

  const practiceId = req.nextUrl.searchParams.get('practice_id')
  const confirm = req.nextUrl.searchParams.get('confirm')
  const releaseExternal =
    req.nextUrl.searchParams.get('release_external') !== 'false'

  if (!practiceId) {
    return NextResponse.json({ error: 'practice_id required' }, { status: 400 })
  }
  if (confirm !== practiceId) {
    return NextResponse.json(
      { error: 'confirm must exactly equal practice_id (safety check)' },
      { status: 400 }
    )
  }

  // Load practice to capture external resource ids before we delete the row.
  const { data: practice, error: loadErr } = await supabaseAdmin
    .from('practices')
    .select(
      'id, name, vapi_assistant_id, twilio_phone_sid, stripe_subscription_id, stripe_customer_id'
    )
    .eq('id', practiceId)
    .maybeSingle()

  if (loadErr) {
    return NextResponse.json({ error: loadErr.message }, { status: 500 })
  }
  if (!practice) {
    return NextResponse.json({ error: 'practice not found' }, { status: 404 })
  }

  const externalCleanup: Record<string, any> = {}

  if (releaseExternal) {
    if (practice.vapi_assistant_id) {
      try {
        await deleteVapiAssistant(practice.vapi_assistant_id)
        externalCleanup.vapi_assistant = {
          id: practice.vapi_assistant_id,
          status: 'deleted',
        }
      } catch (e: any) {
        externalCleanup.vapi_assistant = {
          id: practice.vapi_assistant_id,
          status: 'error',
          error: e?.message || String(e),
        }
      }
    }
    if (practice.twilio_phone_sid) {
      try {
        await releaseTwilioNumber(practice.twilio_phone_sid)
        externalCleanup.twilio_number = {
          sid: practice.twilio_phone_sid,
          status: 'released',
        }
      } catch (e: any) {
        externalCleanup.twilio_number = {
          sid: practice.twilio_phone_sid,
          status: 'error',
          error: e?.message || String(e),
        }
      }
    }
    if (practice.stripe_subscription_id) {
      externalCleanup.stripe_subscription = {
        id: practice.stripe_subscription_id,
        status: 'skipped',
        note: 'Not auto-cancelled — revoke in Stripe dashboard if needed.',
      }
    }
  }

  // Cascade-delete the practice row. Child tables use ON DELETE CASCADE.
  // Note: auth.users entries tied to this practice's staff are NOT removed —
  //       the business-level `users` table cascades but Supabase auth is
  //       separate. Orphaned auth rows are harmless.
  const { error: delErr } = await supabaseAdmin
    .from('practices')
    .delete()
    .eq('id', practiceId)

  if (delErr) {
    return NextResponse.json(
      { error: delErr.message, externalCleanup },
      { status: 500 }
    )
  }

  return NextResponse.json({
    ok: true,
    deleted_practice: { id: practice.id, name: practice.name },
    externalCleanup,
  })
}
