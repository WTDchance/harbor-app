// app/api/practices/route.ts
//
// Wave 23 (AWS port). Read + create the caller's practice. Cognito
// session resolves the user → practice via users.cognito_sub +
// users.practice_id (canonical), with a fallback to practices.owner_email
// match for legacy users that haven't been linked yet.
//
// POST inserts a practices row with the caller as owner (writes
// users row too). Phone uniqueness is enforced via a SELECT pre-check
// on the legacy 'phone_number' column for backward compat — Wave 19
// signup writes 'phone' on the canonical column, so the unique check
// looks at both.

import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/aws/db'
import { requireApiSession } from '@/lib/aws/api-auth'

export async function GET(request: NextRequest) {
  const ctx = await requireApiSession()
  if (ctx instanceof NextResponse) return ctx

  const requestedId = request.nextUrl.searchParams.get('id')
  const targetId = requestedId ?? ctx.practiceId
  if (!targetId) return NextResponse.json({ error: 'No practice' }, { status: 404 })

  // Non-admins can only read their own practice.
  if (requestedId && requestedId !== ctx.practiceId) {
    const adminEmail = (process.env.ADMIN_EMAIL || '').toLowerCase()
    if (!adminEmail || ctx.session.email.toLowerCase() !== adminEmail) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const { rows } = await pool.query(
    `SELECT * FROM practices WHERE id = $1 LIMIT 1`,
    [targetId],
  )
  if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(rows[0])
}

export async function POST(request: NextRequest) {
  const ctx = await requireApiSession()
  if (ctx instanceof NextResponse) return ctx

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const { name, ai_name, phone_number, timezone } = body
  if (!name || !phone_number) {
    return NextResponse.json({ error: 'Missing required fields: name, phone_number' }, { status: 400 })
  }

  const { rows: dupes } = await pool.query(
    `SELECT id FROM practices
      WHERE phone = $1 OR twilio_phone_number = $1 OR signalwire_number = $1
      LIMIT 1`,
    [phone_number],
  )
  if (dupes.length > 0) {
    return NextResponse.json({ error: 'Phone number already in use' }, { status: 409 })
  }

  try {
    const ins = await pool.query(
      `INSERT INTO practices
          (name, ai_name, phone, owner_email, billing_email, timezone)
        VALUES ($1, $2, $3, $4, $4, $5)
        RETURNING *`,
      [
        name,
        ai_name || 'Ellie',
        phone_number,
        ctx.session.email.toLowerCase(),
        timezone || 'America/Los_Angeles',
      ],
    )
    const practice = ins.rows[0]

    // Link caller → practice (if not already)
    await pool.query(
      `INSERT INTO users (cognito_sub, email, practice_id, role)
       VALUES ($1, $2, $3, 'owner')
       ON CONFLICT (cognito_sub) DO UPDATE SET practice_id = COALESCE(users.practice_id, EXCLUDED.practice_id)`,
      [ctx.session.sub, ctx.session.email.toLowerCase(), practice.id],
    )

    return NextResponse.json(practice, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
