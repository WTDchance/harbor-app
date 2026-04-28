// app/api/ehr/patients/duplicate-check/route.ts
//
// W44 T4 — duplicate detection ahead of new-patient creation.
//
// Body: { first_name, last_name, dob?, phone?, email? }
//
// Tiers:
//   1. Exact match on (lower(first_name), lower(last_name), dob,
//      practice_id) → 'block' verdict with the existing patient row.
//      Caller must merge / pick existing instead of creating.
//   2. Trigram-similar name (similarity > 0.45) AND matching DOB →
//      'warn' verdict with candidate list.
//   3. Phone or email match alone → 'soft_warn' verdict with candidates.
//   4. Otherwise → 'clear'.
//
// Always emits patient_duplicate.detected when any tier fires.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SIMILARITY_THRESHOLD = 0.45

type Candidate = {
  id: string
  first_name: string | null
  last_name: string | null
  dob: string | null
  phone: string | null
  email: string | null
  reason: 'name_similar_dob_match' | 'phone_match' | 'email_match'
  similarity?: number
}

export async function POST(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'invalid_json' }, { status: 400 })

  const firstName = String(body.first_name || '').trim()
  const lastName = String(body.last_name || '').trim()
  const dob = body.dob ? String(body.dob).slice(0, 10) : null
  const phone = body.phone ? String(body.phone).trim() : null
  const email = body.email ? String(body.email).trim().toLowerCase() : null

  if (!firstName || !lastName) {
    return NextResponse.json({ error: 'first_name and last_name required' }, { status: 400 })
  }

  // ---- Tier 1: exact match on name + dob ------------------------------
  let exact: Candidate[] = []
  if (dob) {
    const r = await pool.query(
      `SELECT id, first_name, last_name, dob::text, phone, email
         FROM patients
        WHERE practice_id = $1
          AND lower(first_name) = lower($2)
          AND lower(last_name) = lower($3)
          AND dob = $4::date
        LIMIT 5`,
      [ctx.practiceId, firstName, lastName, dob],
    )
    exact = r.rows.map((row: any) => ({
      ...row,
      reason: 'name_similar_dob_match' as const,
      similarity: 1.0,
    }))
  }

  if (exact.length > 0) {
    await auditEhrAccess({
      ctx,
      action: 'patient_duplicate.detected',
      resourceType: 'patient',
      details: { tier: 'block', candidate_count: exact.length },
    })
    return NextResponse.json({
      verdict: 'block',
      message: 'A patient with this exact name and DOB already exists.',
      candidates: exact,
    })
  }

  // ---- Tier 2: name-similar + matching DOB ----------------------------
  const fullName = `${firstName} ${lastName}`
  let similarMatchedDob: Candidate[] = []
  if (dob) {
    const r = await pool.query(
      `SELECT id, first_name, last_name, dob::text, phone, email,
              similarity(lower(first_name || ' ' || last_name), lower($2)) AS sim
         FROM patients
        WHERE practice_id = $1
          AND dob = $3::date
          AND similarity(lower(first_name || ' ' || last_name), lower($2)) > $4
        ORDER BY sim DESC
        LIMIT 5`,
      [ctx.practiceId, fullName, dob, SIMILARITY_THRESHOLD],
    )
    similarMatchedDob = r.rows.map((row: any) => ({
      id: row.id,
      first_name: row.first_name,
      last_name: row.last_name,
      dob: row.dob,
      phone: row.phone,
      email: row.email,
      similarity: Number(row.sim),
      reason: 'name_similar_dob_match' as const,
    }))
  }

  if (similarMatchedDob.length > 0) {
    await auditEhrAccess({
      ctx,
      action: 'patient_duplicate.detected',
      resourceType: 'patient',
      details: { tier: 'warn', candidate_count: similarMatchedDob.length },
    })
    return NextResponse.json({
      verdict: 'warn',
      message: 'We found a patient with a similar name and the same date of birth — is this them?',
      candidates: similarMatchedDob,
    })
  }

  // ---- Tier 3: phone or email match alone -----------------------------
  const conds: string[] = []
  const args: any[] = [ctx.practiceId]
  if (phone) { args.push(phone); conds.push(`phone = $${args.length}`) }
  if (email) { args.push(email); conds.push(`lower(email) = $${args.length}`) }

  let softCandidates: Candidate[] = []
  if (conds.length > 0) {
    const r = await pool.query(
      `SELECT id, first_name, last_name, dob::text, phone, email
         FROM patients
        WHERE practice_id = $1
          AND (${conds.join(' OR ')})
        LIMIT 5`,
      args,
    )
    softCandidates = r.rows.map((row: any) => {
      const matchedPhone = phone && row.phone === phone
      return {
        id: row.id,
        first_name: row.first_name,
        last_name: row.last_name,
        dob: row.dob,
        phone: row.phone,
        email: row.email,
        reason: matchedPhone ? 'phone_match' as const : 'email_match' as const,
      }
    })
  }

  if (softCandidates.length > 0) {
    await auditEhrAccess({
      ctx,
      action: 'patient_duplicate.detected',
      resourceType: 'patient',
      details: { tier: 'soft_warn', candidate_count: softCandidates.length },
    })
    return NextResponse.json({
      verdict: 'soft_warn',
      message: 'A patient with this phone or email already exists. Different person, or duplicate?',
      candidates: softCandidates,
    })
  }

  return NextResponse.json({ verdict: 'clear', candidates: [] })
}
