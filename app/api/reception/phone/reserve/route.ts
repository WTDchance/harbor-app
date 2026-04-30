// W52 D6 — soft-reserve a phone number for 24 hours during onboarding.
import { NextResponse, type NextRequest } from 'next/server'
import { requireReceptionApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { writeAuditLog } from '@/lib/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const ctx = await requireReceptionApiSession()
  if (ctx instanceof NextResponse) return ctx
  if (!ctx.practiceId) return NextResponse.json({ error: 'no_practice' }, { status: 400 })

  const body = await req.json().catch(() => null) as
    { phone_number?: string; region?: string; locality?: string } | null
  if (!body?.phone_number) return NextResponse.json({ error: 'phone_number_required' }, { status: 400 })

  // Reuse an active reservation by this practice on the same number.
  const existing = await pool.query(
    `SELECT id, expires_at FROM practice_phone_reservations
      WHERE practice_id = $1 AND phone_number = $2
        AND released_at IS NULL AND claimed_at IS NULL
        AND expires_at > NOW() LIMIT 1`,
    [ctx.practiceId, body.phone_number],
  )
  if (existing.rows.length > 0) {
    return NextResponse.json({ reservation: existing.rows[0], reused: true })
  }

  try {
    const ins = await pool.query(
      `INSERT INTO practice_phone_reservations
         (practice_id, phone_number, region, locality, reserved_by_user_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, phone_number, expires_at`,
      [ctx.practiceId, body.phone_number, body.region ?? null, body.locality ?? null, ctx.user.id],
    )
    await writeAuditLog({
      practice_id: ctx.practiceId, user_id: ctx.user.id,
      action: 'reception_phone.reserved', resource_type: 'practice_phone_reservation',
      resource_id: ins.rows[0].id, severity: 'info',
      details: { phone_number: body.phone_number },
    })
    return NextResponse.json({ reservation: ins.rows[0], reused: false }, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: 'already_reserved', message: 'Another practice is holding this number; try a different one.' }, { status: 409 })
  }
}

export async function DELETE(req: NextRequest) {
  const ctx = await requireReceptionApiSession()
  if (ctx instanceof NextResponse) return ctx
  if (!ctx.practiceId) return NextResponse.json({ error: 'no_practice' }, { status: 400 })

  const phoneNumber = req.nextUrl.searchParams.get('phone_number')
  if (!phoneNumber) return NextResponse.json({ error: 'phone_number_required' }, { status: 400 })

  await pool.query(
    `UPDATE practice_phone_reservations SET released_at = NOW()
      WHERE practice_id = $1 AND phone_number = $2 AND released_at IS NULL AND claimed_at IS NULL`,
    [ctx.practiceId, phoneNumber],
  )
  return NextResponse.json({ ok: true })
}
