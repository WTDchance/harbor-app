// Mental-health payer-name → Stedi trading-partner ID (AWS port via pool).
//
// Two-tier lookup:
//   1. Fast: hardcoded PAYER_IDS map (instant, no DB call)
//   2. Fallback: stedi_payers table (full Stedi directory, ~3600 payers)

import { pool } from '@/lib/aws/db'

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

const NAME_DOB_ELIGIBLE = new Set<string>([
  'ZRTGI', 'JZSAE', 'JYMNM', '77003', '00120',
])

export function resolvePayerId(
  insuranceCompany: string | null | undefined,
  explicitPayerId?: string | null,
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
 * DB lookup tries: exact display_name → alias array → names array → trigram
 * fuzzy match. The match_stedi_payer pg function (if present) provides the
 * trigram path; we fall back to a plain ILIKE %term% if the function isn't
 * deployed.
 */
export async function resolvePayerIdWithDb(
  insuranceCompany: string | null | undefined,
  explicitPayerId?: string | null,
): Promise<string | null> {
  const fast = resolvePayerId(insuranceCompany, explicitPayerId)
  if (fast) return fast
  if (!insuranceCompany) return null
  const search = insuranceCompany.trim()
  if (!search) return null

  try {
    // 1. Exact display_name (case-insensitive).
    const exact = await pool.query(
      `SELECT stedi_id FROM stedi_payers
        WHERE LOWER(display_name) = LOWER($1)
          AND eligibility_supported = true
        LIMIT 1`,
      [search],
    )
    if (exact.rows[0]) return exact.rows[0].stedi_id

    // 2. Alias array contains.
    const alias = await pool.query(
      `SELECT stedi_id FROM stedi_payers
        WHERE aliases @> $1::jsonb
          AND eligibility_supported = true
        LIMIT 1`,
      [JSON.stringify([search])],
    )
    if (alias.rows[0]) return alias.rows[0].stedi_id

    // 3. Names array contains.
    const nameMatch = await pool.query(
      `SELECT stedi_id FROM stedi_payers
        WHERE names @> $1::jsonb
          AND eligibility_supported = true
        LIMIT 1`,
      [JSON.stringify([search])],
    )
    if (nameMatch.rows[0]) return nameMatch.rows[0].stedi_id

    // 4. Trigram fuzzy via stored function (preferred), or ILIKE fallback.
    try {
      const fuzzy = await pool.query(
        `SELECT * FROM match_stedi_payer($1)`,
        [search.toLowerCase()],
      )
      if (fuzzy.rows[0]?.stedi_id) return fuzzy.rows[0].stedi_id
    } catch {
      const ilike = await pool.query(
        `SELECT stedi_id FROM stedi_payers
          WHERE display_name ILIKE $1
            AND eligibility_supported = true
          LIMIT 1`,
        [`%${search}%`],
      )
      if (ilike.rows[0]) return ilike.rows[0].stedi_id
    }

    return null
  } catch (err) {
    console.error('[payers] DB lookup failed:', (err as Error).message)
    return null
  }
}

export function payerAcceptsNameDobLookup(payerId: string): boolean {
  return NAME_DOB_ELIGIBLE.has(payerId)
}

export function knownPayerNames(): string[] {
  return Object.keys(PAYER_IDS)
}
