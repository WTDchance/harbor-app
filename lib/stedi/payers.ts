// Mental-health payer-name -> Stedi trading-partner ID.
// Source of truth: https://www.stedi.com/healthcare/network
// Confirm any payer ID with Stedi support before relying on it for a live payer.
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
  'Oregon Health Plan': 'OREMD',
  'OHP': 'OREMD',
  'Oregon Medicaid': 'OREMD',
  'Cascade Health Alliance': '93688',
  'CHA': '93688',
}

// Payers where we can attempt an eligibility check with just name + DOB (no member ID).
// Mostly government payers where the member ID is derived from SSN or the payer will
// match by demographics. Commercial payers require a member ID.
const NAME_DOB_ELIGIBLE = new Set<string>([
  'OREMD',  // Oregon Medicaid / OHP
  '77003',  // Medicaid (generic)
  '00120',  // Medicare
])

export function resolvePayerId(
  insuranceCompany: string | null | undefined,
  explicitPayerId?: string | null
): string | null {
  if (explicitPayerId) return explicitPayerId
  if (!insuranceCompany) return null
  if (PAYER_IDS[insuranceCompany]) return PAYER_IDS[insuranceCompany]
  // Case-insensitive fallback for "oregon medicaid" vs "Oregon Medicaid" etc.
  const normalized = insuranceCompany.trim().toLowerCase()
  for (const [name, id] of Object.entries(PAYER_IDS)) {
    if (name.toLowerCase() === normalized) return id
  }
  return null
}

export function payerAcceptsNameDobLookup(payerId: string): boolean {
  return NAME_DOB_ELIGIBLE.has(payerId)
}

export function knownPayerNames(): string[] {
  return Object.keys(PAYER_IDS)
}
