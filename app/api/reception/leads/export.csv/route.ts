// app/api/reception/leads/export.csv/route.ts
//
// W51 D2 — CSV export of reception leads, filtered by status / range.

import { NextResponse, type NextRequest } from 'next/server'
import { requireReceptionApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { writeAuditLog } from '@/lib/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const COLUMNS = [
  'created_at', 'status', 'first_name', 'last_name', 'date_of_birth',
  'phone_e164', 'email', 'insurance_payer', 'insurance_member_id',
  'insurance_group_number', 'reason_for_visit', 'urgency_level',
  'preferred_therapist', 'preferred_appointment_window', 'notes',
  'exported_at',
] as const

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return ''
  const s = typeof v === 'string' ? v : (v instanceof Date ? v.toISOString() : String(v))
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"'
  }
  return s
}

export async function GET(req: NextRequest) {
  const ctx = await requireReceptionApiSession()
  if (ctx instanceof NextResponse) return ctx
  if (!ctx.practiceId) return NextResponse.json({ error: 'no_practice' }, { status: 400 })

  const sp = req.nextUrl.searchParams
  const status = sp.get('status')
  const range = sp.get('range') // '7d' | '30d' | '90d' | 'all'

  const args: any[] = [ctx.practiceId]
  let cond = 'practice_id = $1'
  if (status && status !== 'all') { args.push(status); cond += ` AND status = $${args.length}` }
  if (range && /^\d+d$/.test(range)) {
    const days = parseInt(range, 10)
    cond += ` AND created_at >= NOW() - INTERVAL '${days} days'`
  }

  const { rows } = await pool.query(
    `SELECT ${COLUMNS.join(', ')}
       FROM reception_leads
      WHERE ${cond}
      ORDER BY created_at DESC
      LIMIT 5000`,
    args,
  )

  const header = COLUMNS.join(',')
  const lines = rows.map(r => COLUMNS.map(c => csvEscape((r as any)[c])).join(','))
  const csv = [header, ...lines].join('\n')

  await writeAuditLog({
    practice_id: ctx.practiceId, user_id: ctx.user.id,
    action: 'reception_lead.exported_csv',
    resource_type: 'reception_lead',
    details: { count: rows.length, status_filter: status, range },
  })

  const fname = `reception-leads-${new Date().toISOString().slice(0, 10)}.csv`
  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${fname}"`,
    },
  })
}
