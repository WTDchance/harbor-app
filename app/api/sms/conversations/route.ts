// app/api/sms/conversations/route.ts
//
// Wave 23 (AWS port). DB-only list of SMS conversations enriched with
// patient names. SMS DISPATCH (the carrier side) lives in Bucket 5
// and is intentionally untouched. Reads from sms_conversations table
// only — no Twilio API calls here.

import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/aws/db'
import { requireApiSession } from '@/lib/aws/api-auth'
import { getEffectivePracticeId } from '@/lib/active-practice'

export async function GET(request: NextRequest) {
  const ctx = await requireApiSession()
  if (ctx instanceof NextResponse) return ctx
  const practiceId = await getEffectivePracticeId(null, { email: ctx.session.email, id: ctx.user.id })
  if (!practiceId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const limit = Math.min(parseInt(request.nextUrl.searchParams.get('limit') || '50', 10) || 50, 200)
  const offset = parseInt(request.nextUrl.searchParams.get('offset') || '0', 10) || 0

  try {
    const { rows: convos } = await pool.query(
      `SELECT id, practice_id, patient_phone, last_message_at,
              last_message_body, last_message_direction, created_at
         FROM sms_conversations
        WHERE practice_id = $1
        ORDER BY last_message_at DESC NULLS LAST
        LIMIT $2 OFFSET $3`,
      [practiceId, limit, offset],
    )
    const phones = Array.from(new Set(convos.map((c: any) => c.patient_phone).filter(Boolean)))
    const nameByPhone = new Map<string, string>()
    if (phones.length > 0) {
      const { rows: pat } = await pool.query(
        `SELECT phone, first_name, last_name FROM patients
          WHERE practice_id = $1 AND phone = ANY($2::text[]) AND deleted_at IS NULL`,
        [practiceId, phones],
      )
      for (const p of pat) {
        nameByPhone.set(p.phone, [p.first_name, p.last_name].filter(Boolean).join(' '))
      }
    }
    const enriched = convos.map((c: any) => ({
      ...c,
      patient_name: nameByPhone.get(c.patient_phone) ?? null,
    }))
    return NextResponse.json({ conversations: enriched, total: enriched.length })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
