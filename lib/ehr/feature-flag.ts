// lib/ehr/feature-flag.ts
// Harbor EHR — per-practice feature-flag check.
//
// Every EHR route (UI + API) must gate on this. Practices without
// ehr_enabled=true should never see EHR surface area.

import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Returns true if the given practice has the EHR module enabled.
 * Falls back to false on any error — fail closed.
 */
export async function isEhrEnabled(
  supabase: SupabaseClient,
  practiceId: string | null | undefined,
): Promise<boolean> {
  if (!practiceId) return false
  try {
    const { data, error } = await supabase
      .from('practices')
      .select('ehr_enabled')
      .eq('id', practiceId)
      .maybeSingle()
    if (error || !data) return false
    return data.ehr_enabled === true
  } catch {
    return false
  }
}
