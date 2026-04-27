// Insurance-card field extraction from Textract AnalyzeDocument(FORMS).
//
// Textract returns KEY_VALUE_SET blocks for whatever the model thinks are
// label/value pairs on the card. Insurance carriers don't follow a single
// schema — "Member ID" might be labelled "ID #", "Subscriber ID",
// "Member No.", "Cardholder ID", and so on. This module is the dirty
// per-payer keyword/regex sweep that maps observed labels to the canonical
// fields we persist.
//
// Strategy:
//   1. Walk Textract KEY/VALUE pairs, lower-case the key, and check it
//      against a list of known synonyms per canonical field.
//   2. For things that aren't always labelled (RX BIN, phone numbers,
//      payer name) fall back to scanning LINE blocks with regexes.
//   3. Return per-field { value, confidence }; missing fields are absent.
//
// Defensive coding: never throw. A weird card just produces fewer fields.

import type { AnalyzeFormsResult } from '@/lib/aws/textract'

export type ParsedField = { value: string; confidence: number }

export type InsuranceCardFields = {
  member_id?: ParsedField
  group_number?: ParsedField
  member_name?: ParsedField
  plan_name?: ParsedField
  plan_type?: ParsedField
  payer_name?: ParsedField
  effective_date?: ParsedField
  rx_bin?: ParsedField
  rx_pcn?: ParsedField
  rx_group?: ParsedField
  customer_service_phone?: ParsedField
  provider_service_phone?: ParsedField
}

export const INSURANCE_FIELD_KEYS = [
  'member_id',
  'group_number',
  'member_name',
  'plan_name',
  'plan_type',
  'payer_name',
  'effective_date',
  'rx_bin',
  'rx_pcn',
  'rx_group',
  'customer_service_phone',
  'provider_service_phone',
] as const

export type InsuranceFieldKey = (typeof INSURANCE_FIELD_KEYS)[number]

// Synonym table: lowercase label fragments mapped to a canonical field.
// First match wins, longest-fragment first within each field.
const FIELD_SYNONYMS: Record<InsuranceFieldKey, string[]> = {
  member_id: [
    'subscriber id',
    'subscriber #',
    'cardholder id',
    'member id',
    'member #',
    'member no',
    'member number',
    'id #',
    'id number',
    'id no',
    'id:',
    'member',
  ],
  group_number: [
    'group number',
    'group no',
    'group #',
    'grp #',
    'grp no',
    'group',
    'grp',
  ],
  member_name: [
    'member name',
    'subscriber name',
    'cardholder',
    'name:',
    'name',
  ],
  plan_name: ['plan name', 'plan'],
  plan_type: [
    'plan type',
    'coverage type',
    'product',
    'network',
    'type:',
  ],
  payer_name: [
    'insurance company',
    'carrier',
    'payer',
    'insurer',
  ],
  effective_date: [
    'effective date',
    'effective',
    'eff date',
    'eff.',
  ],
  rx_bin: ['rx bin', 'bin #', 'bin no', 'bin:'],
  rx_pcn: ['rx pcn', 'pcn #', 'pcn:'],
  rx_group: ['rx group', 'rx grp', 'rxgrp'],
  customer_service_phone: [
    'member services',
    'customer service',
    'member phone',
    'questions',
  ],
  provider_service_phone: [
    'provider services',
    'provider phone',
    'for providers',
    'provider:',
  ],
}

const PHONE_RE = /(?:1[-.\s]?)?\(?([2-9]\d{2})\)?[-.\s]?([2-9]\d{2})[-.\s]?(\d{4})/

const RX_BIN_RE = /\bBIN[:#\s]*([0-9]{6})\b/i
const RX_PCN_RE = /\bPCN[:#\s]*([A-Z0-9]{2,12})\b/i
const RX_GRP_RE = /\bRX\s*GRP[:#\s]*([A-Z0-9-]{2,16})\b/i

// Common payer markers — used as a last resort if Textract didn't produce
// a clear "Insurance Company:" key. Keep this list short; we'd rather
// surface "no payer detected" than guess wrong.
const PAYER_MARKERS = [
  'aetna',
  'anthem',
  'blue cross',
  'blue shield',
  'bcbs',
  'cigna',
  'humana',
  'kaiser',
  'unitedhealthcare',
  'united healthcare',
  'uhc',
  'medicare',
  'medicaid',
  'tricare',
  'oscar',
  'oxford',
  'molina',
  'centene',
]

/**
 * Map a parsed Textract result to canonical insurance card fields.
 */
export function extractInsuranceFields(
  textract: AnalyzeFormsResult,
): InsuranceCardFields {
  const out: InsuranceCardFields = {}
  const used = new Set<string>()

  // 1. KEY/VALUE pass: walk every Textract key, find first synonym match.
  for (const fieldKey of INSURANCE_FIELD_KEYS) {
    if (out[fieldKey]) continue
    for (const synonym of FIELD_SYNONYMS[fieldKey]) {
      const match = findKeyValue(textract.keyValues, synonym, used)
      if (match) {
        out[fieldKey] = match.kv
        used.add(match.matchedKey)
        break
      }
    }
  }

  // 2. Regex fallbacks on raw LINE text — phones + RX fields are often
  //    rendered without explicit KEY/VALUE structure on the card back.
  const allLines = textract.lines.map(l => l.text).join('\n')
  const lineConf = avgConfidence(textract.lines)

  if (!out.rx_bin) {
    const m = allLines.match(RX_BIN_RE)
    if (m) out.rx_bin = { value: m[1], confidence: lineConf }
  }
  if (!out.rx_pcn) {
    const m = allLines.match(RX_PCN_RE)
    if (m) out.rx_pcn = { value: m[1], confidence: lineConf }
  }
  if (!out.rx_group) {
    const m = allLines.match(RX_GRP_RE)
    if (m) out.rx_group = { value: m[1], confidence: lineConf }
  }

  // Phone-number extraction:
  //   * If a customer-service / provider-service KV grabbed text without a
  //     phone, run the phone regex over the captured value.
  //   * Otherwise scan all LINEs for phone numbers; the first phone after
  //     "members"/"customer" wording becomes customer_service_phone, and
  //     the first phone after "provider" wording becomes provider_service_phone.
  if (out.customer_service_phone && !PHONE_RE.test(out.customer_service_phone.value)) {
    const m = out.customer_service_phone.value.match(PHONE_RE)
    if (m) out.customer_service_phone = {
      value: formatPhone(m),
      confidence: out.customer_service_phone.confidence,
    }
  }
  if (out.provider_service_phone && !PHONE_RE.test(out.provider_service_phone.value)) {
    const m = out.provider_service_phone.value.match(PHONE_RE)
    if (m) out.provider_service_phone = {
      value: formatPhone(m),
      confidence: out.provider_service_phone.confidence,
    }
  }

  if (!out.customer_service_phone || !out.provider_service_phone) {
    let lastBucket: 'member' | 'provider' | null = null
    for (const line of textract.lines) {
      const lower = line.text.toLowerCase()
      if (/(member|customer|patient)/i.test(lower)) lastBucket = 'member'
      else if (/provider/i.test(lower)) lastBucket = 'provider'

      const m = line.text.match(PHONE_RE)
      if (m && lastBucket === 'member' && !out.customer_service_phone) {
        out.customer_service_phone = { value: formatPhone(m), confidence: line.confidence }
      } else if (m && lastBucket === 'provider' && !out.provider_service_phone) {
        out.provider_service_phone = { value: formatPhone(m), confidence: line.confidence }
      }
    }
  }

  // 3. Payer-name fallback: if AnalyzeDocument didn't yield a labelled
  //    payer, scan LINE blocks for known carrier names. Prefer the
  //    longest match (e.g. "Blue Cross Blue Shield" over "Blue Cross").
  if (!out.payer_name) {
    let best: { name: string; confidence: number } | null = null
    for (const line of textract.lines) {
      const lower = line.text.toLowerCase()
      for (const marker of PAYER_MARKERS) {
        if (lower.includes(marker)) {
          if (!best || line.text.length > best.name.length) {
            best = { name: line.text.trim(), confidence: line.confidence }
          }
        }
      }
    }
    if (best) out.payer_name = { value: best.name, confidence: best.confidence }
  }

  return out
}

/**
 * Merge two parsed-card extractions (front + back) into a single record.
 * Per-field preference: highest confidence wins. The back of an insurance
 * card almost always carries RX BIN / PCN / phone numbers, while the
 * front carries member ID / payer / plan — so this merge naturally
 * combines both sides into one record.
 */
export function mergeFields(
  a: InsuranceCardFields,
  b: InsuranceCardFields,
): InsuranceCardFields {
  const out: InsuranceCardFields = {}
  for (const k of INSURANCE_FIELD_KEYS) {
    const av = a[k]
    const bv = b[k]
    if (av && bv) out[k] = av.confidence >= bv.confidence ? av : bv
    else if (av) out[k] = av
    else if (bv) out[k] = bv
  }
  return out
}

/**
 * Aggregate confidence — minimum across all populated fields. NULL if
 * nothing was extracted.
 */
export function aggregateConfidence(fields: InsuranceCardFields): number | null {
  const confs = INSURANCE_FIELD_KEYS
    .map(k => fields[k]?.confidence)
    .filter((c): c is number => typeof c === 'number')
  if (!confs.length) return null
  return Math.min(...confs)
}

/**
 * List of field keys whose confidence is below the given threshold.
 * The frontend highlights these yellow with a "Please verify" prompt.
 */
export function lowConfidenceFields(
  fields: InsuranceCardFields,
  threshold = 0.85,
): InsuranceFieldKey[] {
  return INSURANCE_FIELD_KEYS.filter(k => {
    const c = fields[k]?.confidence
    return typeof c === 'number' && c < threshold
  })
}

// --- helpers ---

function findKeyValue(
  keyValues: Record<string, { value: string; confidence: number }>,
  synonym: string,
  used: Set<string>,
): { matchedKey: string; kv: ParsedField } | null {
  const syn = synonym.toLowerCase()
  for (const [k, v] of Object.entries(keyValues)) {
    if (used.has(k)) continue
    if (k === syn || k.includes(syn) || syn.includes(k)) {
      return { matchedKey: k, kv: { value: v.value, confidence: v.confidence } }
    }
  }
  return null
}

function avgConfidence(lines: Array<{ confidence: number }>): number {
  if (!lines.length) return 0
  return lines.reduce((s, l) => s + l.confidence, 0) / lines.length
}

function formatPhone(m: RegExpMatchArray): string {
  return `(${m[1]}) ${m[2]}-${m[3]}`
}
