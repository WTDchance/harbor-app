// Mental-health payer-name -> Stedi trading-partner ID.
//
// Two-tier lookup:
//   1. Fast: hardcoded PAYER_IDS map (instant, no DB call)
//   2. Fallback: stedi_payers table (full Stedi directory, ~3600 payers)
//
// The hardcoded map covers the most common names patients use.
// The DB fallback catches everything else — so we never return "unknown payer"
// for a payer that Stedi actually supports.

import type { SupabaseClient } from '@supabase/supabase-js'

export const PAYER_IDS: Record<string, string> = {
  'Aetna': '60054',
  'Cigna': '62308',
  'United Healthcare': '87726',
  'UnitedHealthcare': '87726',
  'Humana': '61101',
  'Anthem': '00227',
  'Anthem BCBS': '00227',
  'Blue Cross Blue Shield': '00310',
  'BCBS': '00310',
  'Magellan Health': 'MGLNBH',
  'Optum': '87726',
  'Beacon Health Options': 'BHLTH',
  'Value Options': 'BHLTH',
  'Tricare': 'TRICR',
  'Medicaid': '77003',
  'Medicare': '00120',
  'Oregon Health Plan': 'ZRTGI',
  'OHP': 'ZRTGI',
  'Oregon Medicaid': 'ZRTGI',
  'Oregon Health Authority': 'ZRTGI',
  'Cascade Health Alliance': 'JZSAE',
  'CHA': 'JZSAE',
  'CareOregon': 'JYMNM',
}

// Payers where we can attempt an eligibility check with just name + DOB (no member ID).
// Mostly government payers where the member ID is derived from SSN or the payer will
// match by demographics. Commercial payers require a member ID.
const NAME_DOB_ELIGIBLE = new Set<string>([
  'ZRTGI',  // Oregon Medicaid / OHP (Stedi ID)
  'JZSAE',  // Cascade Health Alliance (Klamath Falls CCO)
  'JYMNM',  // CareOregon (CCO)
  '77003',  // Medicaid (generic)
  '00120',  // Medicare
])

/**
 * Resolve a payer name to a Stedi trading-partner ID.
 *
 * Synchronous — checks the hardcoded map only.
 * Use `resolvePayerIdWithDb()` for the full two-tier lookup.
 */
export function resolvePayerId(
  insuranceCompany: string | null | undefined,
  explicitPayerId?: string | null
): string | null {
  if (explicitPayerId) return explicitPayerId
  if (!insuranceCompany) return null
  if (PAYER_IDS[insuranceCompany]) return PAYER_IDS[insuranceCompany]
  const normalized = insuranceCompany.trim().toLowerCase()
  for (const [name, id] of Object.entries(PAYER_IDS)) {
    if (name.toLowerCase() === normalized) return id
  }
  return null
}

/**
 * Two-tier payer resolution: hardcoded map first, then DB lookup.
 *
 * DB lookup searches stedi_payers by:
 *   1. Exact display_name match (case-insensitive)
 *   2. Alias array containment (the patient might say "CHA01" or "ORDHS")
 *   3. Names array containment (alternate names Stedi provides)
 *   4. Trigram similarity on display_name (fuzzy match, e.g. "Cascad Health" → "Cascade Health Alliance")
 *
 * Only returns payers that support eligibility checks.
 */
export async function resolvePayerIdWithDb(
  supabase: SupabaseClient,
  insuranceCompany: string | null | undefined,
  explicitPayerId?: string | null
): Promise<string | null> {
  // Fast path: hardcoded map
  const fast = resolvePayerId(insuranceCompany, explicitPayerId)
  if (fast) return fast
  if (!insuranceCompany) return null

  const search = insuranceCompany.trim()
  if (!search) return null

  try {
    // 1. Exact display_name match (case-insensitive)
    const { data: exact } = await supabase
      .from('stedi_payers')
      .select('stedi_id')
      .ilike('display_name', search)
      .eq('eligibility_supported', true)
      .limit(1)
      .single()
    if (exact) return exact.stedi_id

    // 2. Check if the search term is an alias (payer ID like "CHA01")
    const { data: alias } = await supabase
      .from('stedi_payers')
      .select('stedi_id')
      .contains('aliases', JSON.stringify([search]))
      .eq('eligibility_supported', true)
      .limit(1)
      .single()
    if (alias) return alias.stedi_id

    // 3. Check if it's in the names array
    const { data: nameMatch } = await supabase
      .from('stedi_payers')
      .select('stedi_id')
      .contains('names', JSON.stringify([search]))
      .eq('eligibility_supported', true)
      .limit(1)
      .single()
    if (nameMatch) return nameMatch.stedi_id

    // 4. Fuzzy trigram match on display_name (requires pg_trgm)
    //    similarity() returns 0-1; 0.3 is the default threshold
    const { data: fuzzy } = await supabase
      .rpc('match_stedi_payer', { search_term: search.toLowerCase() })
    if (fuzzy && fuzzy.length > 0) return fuzzy[0].stedi_id

    return null
  } catch (err) {
    console.error('[payers] DB lookup failed, returning null:', err)
    return null
  }
}

export function payerAcceptsNameDobLookup(payerId: string): boolean {
  return NAME_DOB_ELIGIBLE.has(payerId)
}

/**
 * Return the list of known payer names (from the hardcoded map).
 * Used by the verify endpoint to suggest corrections for typos.
 */
export function knownPayerNames(): string[] {
  return Object.keys(PAYER_IDS)
}