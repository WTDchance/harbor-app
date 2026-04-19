// Do-Not-Call list. Passive today — Harbor only answers inbound calls, so
// there's no outbound-call gate to wire. Captured now so the state is ready
// whenever outbound calling ships (reminder calls, win-back calls, etc.).

import { supabaseAdmin } from './supabase'

export type CallOptOutSource = 'dashboard' | 'api'

export async function recordCallOptOut(
  practiceId: string,
  phone: string,
  source: CallOptOutSource = 'dashboard'
): Promise<void> {
  if (!phone) return
  try {
    await supabaseAdmin.from('call_opt_outs').upsert(
      { practice_id: practiceId, phone, source },
      { onConflict: 'practice_id,phone' }
    )
  } catch (err) {
    console.error('[call-optout] failed to record opt-out:', err)
  }
}

export async function clearCallOptOut(
  practiceId: string,
  phone: string
): Promise<void> {
  if (!phone) return
  try {
    await supabaseAdmin
      .from('call_opt_outs')
      .delete()
      .eq('practice_id', practiceId)
      .eq('phone', phone)
  } catch (err) {
    console.error('[call-optout] failed to clear opt-out:', err)
  }
}

export async function isCallOptedOut(
  practiceId: string,
  phone: string
): Promise<boolean> {
  if (!phone) return false
  try {
    const { data } = await supabaseAdmin
      .from('call_opt_outs')
      .select('id')
      .eq('practice_id', practiceId)
      .eq('phone', phone)
      .maybeSingle()
    return !!data
  } catch (err) {
    console.error('[call-optout] isCallOptedOut check failed:', err)
    return false
  }
}
