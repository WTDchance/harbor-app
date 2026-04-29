// W51 D6 — release a SignalWire number.
import { NextResponse, type NextRequest } from 'next/server'
import { requireReceptionApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { writeAuditLog } from '@/lib/audit'
import { releaseSignalWireNumber } from '@/lib/aws/provisioning/signalwire-numbers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ sid: string }> }) {
  const ctx = await requireReceptionApiSession()
  if (ctx instanceof NextResponse) return ctx
  if (!ctx.practiceId) return NextResponse.json({ error: 'no_practice' }, { status: 400 })
  const { sid } = await params

  const ok = await releaseSignalWireNumber(sid)

  await pool.query(
    `UPDATE practices
        SET signalwire_phone_number = NULL,
            signalwire_phone_number_sid = NULL
      WHERE id = $1 AND signalwire_phone_number_sid = $2`,
    [ctx.practiceId, sid],
  ).catch(() => null)

  await writeAuditLog({
    practice_id: ctx.practiceId, user_id: ctx.user.id,
    action: 'reception_phone.released', resource_type: 'practice', severity: 'info',
    details: { sid, signalwire_ok: ok },
  })
  return NextResponse.json({ ok: true, signalwire_ok: ok })
}
