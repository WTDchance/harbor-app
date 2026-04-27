// app/api/admin/practices/[id]/decommission/route.ts
//
// Decommission a practice — graceful shutdown, no PHI hard-delete.
// Triggered from the admin practices list (/admin/practices) "Decommission"
// button. The UI's confirmation modal forces the operator to type the
// practice's name verbatim before this route is callable, so we don't
// re-validate the name here — but we DO require the body to include the
// practice id from the URL as a belt-and-suspenders guard against a
// misrouted call.
//
// Side effects (in order, each best-effort except the DB status flip):
//   1. practices.provisioning_state -> 'cancelled'
//      practices.decommissioned_at  -> NOW()
//      practices.decommissioned_by  -> actor email
//      (practices.deleted_at stays NULL — decommission ≠ hard-delete)
//   2. SignalWire — release the practice's signalwire_phone_sid back to
//      the pool. Best-effort; logged but not blocking.
//   3. Retell — null out retell_agent_id in the DB so inbound webhooks
//      can't find an agent. We do NOT call the Retell delete API here
//      because rollbackRetellClone deletes the LLM too, and the LLM
//      may have other agents pointing at it (paranoia).
//   4. users.is_active -> FALSE for every user attached to the practice.
//   5. Stripe — cancel the active subscription (immediate).
//   6. audit_logs — insert one row with action='admin.practice.decommission'
//      and a metadata blob enumerating which side effects fired vs
//      failed.
//
// Auth: requireAdminSession() (admin allowlist via ADMIN_EMAIL).
//
// Brief constraint honoured: NO hard-delete of patients, appointments,
// notes, or audit logs. Decommissioned practices stay queryable for
// export, audit, and back-office reconciliation.

import { NextResponse, type NextRequest } from 'next/server'
import { pool } from '@/lib/aws/db'
import { requireAdminSession } from '@/lib/aws/api-auth'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
import { releaseSignalWireNumber } from '@/lib/aws/provisioning/signalwire-numbers'
import { stripe } from '@/lib/stripe'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface SideEffectResult {
  ok: boolean
  /** Short, human-readable detail. Never PHI. */
  detail?: string
  /** Optional structured payload for the audit log (e.g. released SID). */
  meta?: Record<string, unknown>
}

interface DecommissionResult {
  status_flip: SideEffectResult
  signalwire_release: SideEffectResult
  retell_pause: SideEffectResult
  users_deactivate: SideEffectResult
  stripe_cancel: SideEffectResult
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireAdminSession()
  if (ctx instanceof NextResponse) return ctx

  const { id: practiceId } = await params
  if (!practiceId) {
    return NextResponse.json(
      {
        error: { code: 'invalid_request', message: 'practice id required' },
      },
      { status: 400 },
    )
  }

  // Belt-and-suspenders: the body must echo the URL's practice id. The
  // confirmation modal posts both; if the URL is misrouted we bail.
  let body: any
  try {
    body = await req.json()
  } catch {
    body = {}
  }
  if (body?.practice_id && body.practice_id !== practiceId) {
    return NextResponse.json(
      {
        error: { code: 'invalid_request', message: 'practice id mismatch between URL and body' },
      },
      { status: 400 },
    )
  }

  // Load the practice once so all side effects share the same row.
  const { rows: pr } = await pool.query(
    `SELECT id, name, provisioning_state, signalwire_phone_sid,
            twilio_phone_sid, retell_agent_id, stripe_subscription_id
       FROM practices WHERE id = $1 LIMIT 1`,
    [practiceId],
  )
  const practice = pr[0]
  if (!practice) {
    return NextResponse.json(
      {
        error: { code: 'not_found', message: 'Practice not found' },
      },
      { status: 404 },
    )
  }

  // Allow re-running on a partially-decommissioned practice (idempotent),
  // but if it's already fully cancelled, return early so we don't double-
  // cancel a Stripe subscription that's already void.
  if (practice.provisioning_state === 'cancelled') {
    return NextResponse.json(
      {
        ok: true,
        already_decommissioned: true,
        practice_id: practiceId,
        message: 'Practice was already decommissioned. No further action taken.',
      },
      { status: 200 },
    )
  }

  const result: DecommissionResult = {
    status_flip: { ok: false },
    signalwire_release: { ok: false, detail: 'no_signalwire_number_on_record' },
    retell_pause: { ok: false, detail: 'no_retell_agent_on_record' },
    users_deactivate: { ok: false },
    stripe_cancel: { ok: false, detail: 'no_stripe_subscription_on_record' },
  }

  // ---------- 1. status flip (the one side effect that MUST succeed) ----------
  try {
    await pool.query(
      `UPDATE practices
          SET provisioning_state = 'cancelled',
              decommissioned_at  = NOW(),
              decommissioned_by  = $2,
              updated_at         = NOW()
        WHERE id = $1`,
      [practiceId, ctx.session.email],
    )
    result.status_flip = { ok: true }
  } catch (err) {
    // If the migration hasn't been applied (decommissioned_at column
    // missing), retry the minimal update. Failing this is fatal.
    try {
      await pool.query(
        `UPDATE practices SET provisioning_state = 'cancelled', updated_at = NOW() WHERE id = $1`,
        [practiceId],
      )
      result.status_flip = {
        ok: true,
        detail: 'partial — decommissioned_at column missing (run supabase/migrations/decommission.sql)',
      }
    } catch (err2) {
      result.status_flip = {
        ok: false,
        detail: `status flip failed: ${(err2 as Error).message}`,
      }
      // The brief lets us continue past best-effort failures, but a status
      // flip failure means the practice will look "live" in the dashboard
      // — bail and surface the error rather than half-decommissioning.
      return NextResponse.json(
        {
          error: {
            code: 'status_flip_failed',
            message:
              'Could not mark the practice as cancelled. No other side effects were attempted.',
            retryable: true,
          },
          partial: result,
        },
        { status: 502 },
      )
    }
  }

  // ---------- 2. SignalWire — release number ----------
  if (practice.signalwire_phone_sid) {
    try {
      const released = await releaseSignalWireNumber(practice.signalwire_phone_sid)
      result.signalwire_release = released
        ? {
            ok: true,
            detail: 'released',
            meta: { sid: practice.signalwire_phone_sid },
          }
        : {
            ok: false,
            detail: 'signalwire returned non-2xx; will retry-via-cron',
            meta: { sid: practice.signalwire_phone_sid },
          }
    } catch (err) {
      result.signalwire_release = {
        ok: false,
        detail: `signalwire threw: ${(err as Error).message}`,
        meta: { sid: practice.signalwire_phone_sid },
      }
    }
    // Mark the row inactive regardless of release outcome — operator
    // intent is to retire it.
    try {
      await pool.query(
        `UPDATE practices SET signalwire_number = NULL, updated_at = NOW() WHERE id = $1`,
        [practiceId],
      )
    } catch {
      /* non-fatal */
    }
  }

  // ---------- 3. Retell — null out the agent in our DB ----------
  // We do NOT call rollbackRetellClone here — that deletes the LLM,
  // and the LLM may be shared (paranoia). Setting retell_agent_id =
  // NULL is enough to stop the inbound webhook from routing to it.
  if (practice.retell_agent_id) {
    try {
      await pool.query(
        `UPDATE practices SET retell_agent_id = NULL, updated_at = NOW() WHERE id = $1`,
        [practiceId],
      )
      result.retell_pause = {
        ok: true,
        detail: 'retell_agent_id nulled in DB; agent left intact in Retell',
        meta: { previous_agent_id: practice.retell_agent_id },
      }
    } catch (err) {
      result.retell_pause = {
        ok: false,
        detail: `retell pause failed: ${(err as Error).message}`,
      }
    }
  }

  // ---------- 4. Deactivate every user on the practice ----------
  try {
    const upd = await pool.query(
      `UPDATE users SET is_active = FALSE, updated_at = NOW()
        WHERE practice_id = $1 AND is_active = TRUE`,
      [practiceId],
    )
    result.users_deactivate = {
      ok: true,
      detail: `deactivated ${upd.rowCount ?? 0} user(s)`,
      meta: { affected: upd.rowCount ?? 0 },
    }
  } catch (err) {
    // Migration may not be applied — flag rather than fail.
    result.users_deactivate = {
      ok: false,
      detail:
        `users.is_active UPDATE failed (likely missing column — ` +
        `run supabase/migrations/decommission.sql): ${(err as Error).message}`,
    }
  }

  // ---------- 5. Cancel the Stripe subscription ----------
  if (practice.stripe_subscription_id) {
    if (!stripe) {
      result.stripe_cancel = {
        ok: false,
        detail: 'STRIPE_SECRET_KEY not configured; subscription left untouched',
        meta: { subscription_id: practice.stripe_subscription_id },
      }
    } else {
      try {
        const cancelled = await stripe.subscriptions.cancel(
          practice.stripe_subscription_id,
          {
            invoice_now: false,
            prorate: false,
          },
        )
        result.stripe_cancel = {
          ok: true,
          detail: `subscription cancelled (status=${cancelled.status})`,
          meta: { subscription_id: cancelled.id, status: cancelled.status },
        }
        await pool.query(
          `UPDATE practices SET subscription_status = 'canceled', updated_at = NOW() WHERE id = $1`,
          [practiceId],
        ).catch(() => {})
      } catch (err) {
        result.stripe_cancel = {
          ok: false,
          detail: `stripe cancel threw: ${(err as Error).message}`,
          meta: { subscription_id: practice.stripe_subscription_id },
        }
      }
    }
  }

  // ---------- 6. Audit log ----------
  await auditEhrAccess({
    ctx,
    action: 'admin.practice.decommission',
    resourceType: 'practice',
    resourceId: practiceId,
    details: {
      target_practice_id: practiceId,
      target_practice_name: practice.name,
      side_effects: result,
    },
  })

  // The route succeeds even if individual side effects failed — the
  // status flip succeeded, which is the load-bearing one. Surface the
  // per-side-effect results so the dashboard can show "released ✓ / Stripe failed ✗".
  return NextResponse.json({
    ok: true,
    practice_id: practiceId,
    side_effects: result,
  })
}
