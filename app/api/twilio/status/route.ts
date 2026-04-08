/**
 * Twilio status callback.
 *
 * Twilio POSTs here on every call status change (initiated, ringing,
 * answered, completed). This gives us a source of truth for inbound calls
 * that's INDEPENDENT of Vapi â so if Vapi silently drops a call or the
 * end-of-call webhook never fires, we still know the call happened.
 *
 * To enable: in Twilio console â Phone Numbers â +15415394890 â
 *   "Call status changes" â set to:
 *     https://harborreceptionist.com/api/twilio/status   (HTTP POST)
 *   Do NOT change the "A call comes in" URL â that still points to Vapi.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { logEvent } from '@/lib/events';

export const runtime = 'nodejs';

function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 10) return null;
  return `+${digits}`;
}

export async function POST(req: NextRequest) {
  try {
    // Twilio sends application/x-www-form-urlencoded
    const form = await req.formData();
    const callSid = form.get('CallSid')?.toString() ?? null;
    const callStatus = form.get('CallStatus')?.toString() ?? null;
    const from = normalizePhone(form.get('From')?.toString());
    const to = normalizePhone(form.get('To')?.toString());
    const duration = form.get('CallDuration')?.toString();
    const timestamp = form.get('Timestamp')?.toString();

    if (!callSid || !callStatus || !to) {
      return NextResponse.json({ ok: true, ignored: true });
    }

    // Look up the practice by the Twilio number that was called.
    const { data: practice } = await supabaseAdmin
      .from('practices')
      .select('id')
      .eq('twilio_phone_number', to)
      .maybeSingle();

    if (!practice) {
      // Unknown number â log at admin level, bail.
      // eslint-disable-next-line no-console
      console.warn('[twilio/status] no practice for', to, callSid);
      return NextResponse.json({ ok: true, ignored: true });
    }

    const eventPayload = {
      twilio_call_sid: callSid,
      call_status: callStatus,
      from,
      to,
      duration_seconds: duration ? Number(duration) : undefined,
      timestamp,
    };

    // Dedupe key: one event per (sid, status) so Twilio retries don't spam.
    const dedupeKey = `${callSid}:${callStatus}`;

    // On "initiated" (earliest signal) â record inbound.
    if (callStatus === 'initiated' || callStatus === 'ringing') {
      await logEvent({
        practiceId: practice.id,
        eventType: 'call.twilio_inbound',
        severity: 'info',
        source: 'twilio',
        message: `Inbound call ${callStatus} from ${from ?? 'unknown'}`,
        payload: eventPayload,
        dedupeKey,
      });
    }

    // On "completed" â update the matching call_logs row with the SID so
    // the reconciler can join later. If no row exists yet, Vapi may still
    // be processing â the reconciler will flag it if it never appears.
    if (callStatus === 'completed') {
      await logEvent({
        practiceId: practice.id,
        eventType: 'call.twilio_inbound',
        severity: 'info',
        source: 'twilio',
        message: `Call completed (${duration ?? '?'}s)`,
        payload: eventPayload,
        dedupeKey,
      });

      // Best-effort: stamp the sid on the most recent call_log for this
      // caller within the last 30 min. If Vapi hasn't written it yet,
      // this is a no-op and the reconciler will handle it.
      if (from) {
        const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
        await supabaseAdmin
          .from('call_logs')
          .update({ twilio_call_sid: callSid, last_event_at: new Date().toISOString() })
          .eq('practice_id', practice.id)
          .eq('patient_phone', from)
          .is('twilio_call_sid', null)
          .gte('created_at', thirtyMinAgo);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[twilio/status] error', err);
    // Always return 200 â we never want Twilio to retry and cascade.
    return NextResponse.json({ ok: true, error: String(err) });
  }
}
