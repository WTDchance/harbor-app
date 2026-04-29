// lib/ehr/custom-forms.ts
//
// W49 D1 — type definitions, validation, and helpers for the practice
// custom-forms builder. Validates submitted schemas at the API boundary
// and submitted responses at portal-submit time.

export const CUSTOM_FORM_FIELD_TYPES = [
  'short_text',
  'long_text',
  'multiselect',
  'select',
  'rating',
  'date',
  'signature',
  'phone',
  'email',
  'number',
] as const

export type CustomFormFieldType = typeof CUSTOM_FORM_FIELD_TYPES[number]

export interface CustomFormFieldValidation {
  /** numeric / string-length min */
  min?: number
  /** numeric / string-length max */
  max?: number
  /** regex source applied to string-coerced value */
  regex?: string
}

export interface CustomFormField {
  /** stable id (random/short) used as the JSONB key in responses */
  id: string
  type: CustomFormFieldType
  label: string
  required: boolean
  /** for select / multiselect / rating */
  options?: string[]
  /** for rating: { min, max } as 1..N scale */
  validation?: CustomFormFieldValidation
  helpText?: string
}

export const FORM_NAME_MAX = 120
export const FORM_SLUG_MAX = 80
export const FORM_DESC_MAX = 600
export const FIELD_LABEL_MAX = 200
export const FIELD_HELP_MAX = 400
export const SHORT_TEXT_MAX_DEFAULT = 200
export const LONG_TEXT_MAX_DEFAULT = 4000
export const MAX_FIELDS_PER_FORM = 100

export function isCustomFormFieldType(s: unknown): s is CustomFormFieldType {
  return typeof s === 'string' && (CUSTOM_FORM_FIELD_TYPES as readonly string[]).includes(s)
}

/**
 * Validate the full schema array. Returns the cleaned schema (trimmed
 * strings, stripped unknown fields) or an error message.
 */
export function validateSchema(input: unknown): { ok: true; schema: CustomFormField[] } | { ok: false; error: string } {
  if (!Array.isArray(input)) return { ok: false, error: 'schema must be an array' }
  if (input.length > MAX_FIELDS_PER_FORM) return { ok: false, error: `too many fields (max ${MAX_FIELDS_PER_FORM})` }

  const out: CustomFormField[] = []
  const seenIds = new Set<string>()

  for (let i = 0; i < input.length; i++) {
    const raw = input[i]
    if (!raw || typeof raw !== 'object') return { ok: false, error: `field ${i}: not an object` }
    const f = raw as Record<string, unknown>

    const id = typeof f.id === 'string' ? f.id.trim() : ''
    if (!id) return { ok: false, error: `field ${i}: id required` }
    if (id.length > 60) return { ok: false, error: `field ${i}: id too long` }
    if (seenIds.has(id)) return { ok: false, error: `field ${i}: duplicate id "${id}"` }
    seenIds.add(id)

    if (!isCustomFormFieldType(f.type)) return { ok: false, error: `field ${i}: invalid type` }
    const type = f.type

    const label = typeof f.label === 'string' ? f.label.trim() : ''
    if (!label) return { ok: false, error: `field ${i}: label required` }
    if (label.length > FIELD_LABEL_MAX) return { ok: false, error: `field ${i}: label too long` }

    const required = !!f.required

    let options: string[] | undefined
    if (type === 'select' || type === 'multiselect') {
      if (!Array.isArray(f.options) || f.options.length === 0) {
        return { ok: false, error: `field ${i}: options required for ${type}` }
      }
      const opts = f.options.map(o => (typeof o === 'string' ? o.trim() : '')).filter(Boolean)
      if (opts.length === 0) return { ok: false, error: `field ${i}: options must be non-empty strings` }
      if (opts.length > 50) return { ok: false, error: `field ${i}: too many options` }
      options = opts
    } else if (type === 'rating') {
      // optional labels for rating extremes; honor first/last as anchors if provided
      if (Array.isArray(f.options)) {
        options = f.options.slice(0, 2).map(o => String(o ?? ''))
      }
    }

    let validation: CustomFormFieldValidation | undefined
    if (f.validation && typeof f.validation === 'object') {
      const v = f.validation as Record<string, unknown>
      validation = {}
      if (typeof v.min === 'number' && Number.isFinite(v.min)) validation.min = v.min
      if (typeof v.max === 'number' && Number.isFinite(v.max)) validation.max = v.max
      if (typeof v.regex === 'string' && v.regex.length <= 200) {
        try { new RegExp(v.regex); validation.regex = v.regex } catch { /* drop bad regex */ }
      }
    }

    const helpText = typeof f.helpText === 'string' ? f.helpText.trim().slice(0, FIELD_HELP_MAX) : undefined

    out.push({ id, type, label, required, options, validation, helpText })
  }
  return { ok: true, schema: out }
}

/**
 * Validate a patient-submitted response against a schema snapshot.
 * Returns the cleaned response keyed by field id, or an error.
 */
export function validateResponse(
  schema: CustomFormField[],
  raw: unknown,
): { ok: true; response: Record<string, unknown> } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'response must be an object' }
  const input = raw as Record<string, unknown>
  const out: Record<string, unknown> = {}

  for (const f of schema) {
    const v = input[f.id]
    const isEmpty = v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)
    if (isEmpty) {
      if (f.required) return { ok: false, error: `field ${f.id} (${f.label}) required` }
      continue
    }

    switch (f.type) {
      case 'short_text': {
        const s = String(v)
        const max = f.validation?.max ?? SHORT_TEXT_MAX_DEFAULT
        if (s.length > max) return { ok: false, error: `field ${f.id}: too long (max ${max})` }
        if (f.validation?.min && s.length < f.validation.min) return { ok: false, error: `field ${f.id}: too short` }
        if (f.validation?.regex) {
          try { if (!new RegExp(f.validation.regex).test(s)) return { ok: false, error: `field ${f.id}: invalid format` } } catch {}
        }
        out[f.id] = s
        break
      }
      case 'long_text': {
        const s = String(v)
        const max = f.validation?.max ?? LONG_TEXT_MAX_DEFAULT
        if (s.length > max) return { ok: false, error: `field ${f.id}: too long (max ${max})` }
        out[f.id] = s
        break
      }
      case 'select': {
        const s = String(v)
        if (!f.options?.includes(s)) return { ok: false, error: `field ${f.id}: not in options` }
        out[f.id] = s
        break
      }
      case 'multiselect': {
        if (!Array.isArray(v)) return { ok: false, error: `field ${f.id}: must be an array` }
        const sel = (v as unknown[]).map(x => String(x))
        for (const s of sel) {
          if (!f.options?.includes(s)) return { ok: false, error: `field ${f.id}: "${s}" not in options` }
        }
        out[f.id] = sel
        break
      }
      case 'rating': {
        const n = Number(v)
        if (!Number.isFinite(n)) return { ok: false, error: `field ${f.id}: must be a number` }
        const min = f.validation?.min ?? 1
        const max = f.validation?.max ?? 5
        if (n < min || n > max) return { ok: false, error: `field ${f.id}: must be ${min}..${max}` }
        out[f.id] = n
        break
      }
      case 'date': {
        const s = String(v)
        if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || isNaN(Date.parse(s))) {
          return { ok: false, error: `field ${f.id}: invalid date` }
        }
        out[f.id] = s
        break
      }
      case 'signature': {
        // Accept either a typed name or a data: URL. Both stored as strings.
        const s = String(v).slice(0, 200_000)
        if (s.length < 1) return { ok: false, error: `field ${f.id}: signature required` }
        out[f.id] = s
        break
      }
      case 'phone': {
        const digits = String(v).replace(/\D/g, '')
        if (digits.length < 10 || digits.length > 15) return { ok: false, error: `field ${f.id}: invalid phone` }
        out[f.id] = String(v).trim()
        break
      }
      case 'email': {
        const s = String(v).trim()
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return { ok: false, error: `field ${f.id}: invalid email` }
        out[f.id] = s
        break
      }
      case 'number': {
        const n = Number(v)
        if (!Number.isFinite(n)) return { ok: false, error: `field ${f.id}: must be a number` }
        if (f.validation?.min !== undefined && n < f.validation.min) return { ok: false, error: `field ${f.id}: below min` }
        if (f.validation?.max !== undefined && n > f.validation.max) return { ok: false, error: `field ${f.id}: above max` }
        out[f.id] = n
        break
      }
    }
  }
  return { ok: true, response: out }
}

/** Generate a stable random id used for fields and tokens (b64url, no padding). */
export function randomId(bytes = 9): string {
  const arr = new Uint8Array(bytes)
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(arr)
  } else {
    // node-only fallback for SSR-time field-id generation
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { randomBytes } = require('node:crypto') as typeof import('node:crypto')
    const buf = randomBytes(bytes)
    for (let i = 0; i < bytes; i++) arr[i] = buf[i]
  }
  let s = ''
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i])
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Slugify a form name for the practice-scoped slug column. */
export function slugify(name: string): string {
  return name.toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, FORM_SLUG_MAX) || 'form'
}
