// W51 D6 — claim a SignalWire number for the current practice.
import { NextResponse, type NextRequest } from 'next/server'
import { requireReceptionApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { writeAuditLog } from '@/lib/audit'
import { purchaseAndConfigureNumber } from '@/lib/aws/provisioning/signalwire-numbers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const ctx = await requireReceptionApiSession()
  if (ctx instanceof NextResponse) return ctx
  if (!ctx.practiceId) return NextResponse.json({ error: 'no_practice' }, { status: 400 })

  const body = await req.json().catch(() => null) as { phone_number?: string; friendly_name?: string } | null
  if (!body?.phone_number) return NextResponse.json({ error: 'phone_number_required' }, { status: 400 })

  let result
  try {
    result = await purchaseAndConfigureNumber({
      phoneNumber: body.phone_number,
      friendlyName: body.friendly_name,
    })
  } catch (e) {
    return NextResponse.json({ error: 'claim_failed', message: (e as Error).message }, { status: 502 })
  }

  // Persist on the practice. Existing schema uses signalwire_phone_number_sid +
  // signalwire_phone_number columns (from W29).
  await pool.query(
    `UPDATE practices
        SET signalwire_phone_number = $1,
            signalwire_phone_number_sid = $2
      WHERE id = $3`,
    [result.phoneNumber, result.sid, ctx.practiceId],
  ).catch(() => null)

  await writeAuditLog({
    practice_id: ctx.practiceId, user_id: ctx.user.id,
    action: 'reception_phone.claimed',
    resource_type: 'practice',
    severity: 'info',
    details: { phone_number: result.phoneNumber, sid: result.sid },
  })

  return NextResponse.json({ phone: result }, { status: 201 })
}
