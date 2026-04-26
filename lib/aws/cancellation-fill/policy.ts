// Cancellation Fill — Policy loader (AWS port).
//
// Reads practices.cancellation_fill_settings (JSONB) via pg pool. Missing
// or malformed settings fail CLOSED (dispatcher_enabled=false) — we never
// auto-fill a practice that hasn't explicitly opted in.
//
// The cancellation_fill_settings column may not exist on every RDS
// cluster (it's added by a Supabase-era migration). On missing column
// the SELECT throws and we degrade gracefully to defaults.

import { pool } from '@/lib/aws/db'
import type { CancellationFillSettings } from './types'

export const DEFAULT_SETTINGS: CancellationFillSettings = {
  dispatcher_enabled: false, // fail-closed — opt-in per practice
  auto_fill_24plus: true,
  auto_fill_8_to_24: true,
  auto_fill_2_to_8: true,
  sub_1_hour_action: 'shift_earlier',
  late_cancel_fee_cents: 0,
  waitlist_sort: 'fifo',
  flash_fill_max_recipients: 2,
  insurance_eligibility_gate: true,
  crisis_lookback_days: 14,
  no_show_lookback_days: 30,
  no_show_threshold: 2,
  outstanding_balance_threshold_cents: 0,
}

export function mergeSettings(
  raw: Partial<CancellationFillSettings> | null | undefined,
): CancellationFillSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS }
  const out: CancellationFillSettings = { ...DEFAULT_SETTINGS }
  for (const k of Object.keys(DEFAULT_SETTINGS) as Array<keyof CancellationFillSettings>) {
    const v = (raw as Record<string, unknown>)[k]
    if (v === undefined || v === null) continue
    const defType = typeof DEFAULT_SETTINGS[k]
    if (typeof v !== defType) continue // shape mismatch → keep default
    // @ts-expect-error narrowed by runtime typeof check above
    out[k] = v
  }
  return out
}

export async function loadSettings(practiceId: string): Promise<CancellationFillSettings> {
  try {
    const { rows } = await pool.query(
      `SELECT cancellation_fill_settings
         FROM practices
        WHERE id = $1
        LIMIT 1`,
      [practiceId],
    )
    if (!rows[0]) return { ...DEFAULT_SETTINGS }
    return mergeSettings(rows[0].cancellation_fill_settings as Partial<CancellationFillSettings>)
  } catch (err) {
    console.warn(
      `[cancellation-fill/policy] Could not load settings for practice ${practiceId}; using defaults`,
      (err as Error).message,
    )
    return { ...DEFAULT_SETTINGS }
  }
}

export function bucketEnabled(
  bucket: '24plus' | '8_to_24' | '2_to_8' | 'sub_1',
  settings: CancellationFillSettings,
): boolean {
  switch (bucket) {
    case '24plus': return settings.auto_fill_24plus
    case '8_to_24': return settings.auto_fill_8_to_24
    case '2_to_8': return settings.auto_fill_2_to_8
    // sub_1 is policy-action driven, not a boolean — always "enabled" if action != accept_loss
    case 'sub_1': return settings.sub_1_hour_action !== 'accept_loss'
  }
}
