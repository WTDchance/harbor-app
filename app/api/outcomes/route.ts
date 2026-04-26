// app/api/outcomes/route.ts
//
// Wave 23 (AWS port). Therapist-side outcomes assessment list +
// create. Cognito + pool. Token minted via crypto.randomBytes —
// public completion lives at /api/outcomes/[token].

import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { pool } from '@/lib/aws/db'
import { requireApiSession } from '@/lib/aws/api-auth'
import { getEffectivePracticeId } from '@/lib/active-practice'

export async function GET(req: NextRequest) {
  const ctx = await requireApiSession()
  if (ctx instanceof NextResponse) return ctx
  const practiceId = await getEffectivePracticeId(null, { email: ctx.session.email, id: ctx.user.id })
  if (!practiceId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const phone = req.nextUrl.searchParams.get('phone')
  const args: any[] = [practiceId]
  let where = `practice_id = $1`
  if (phone) {
    args.push(phone)
    where += ` AND patient_phone = $${args.length}`
  }
  try {
    const { rows } = await pool.query(
      `SELECT * FROM outcome_assessments WHERE ${where} ORDER BY created_at DESC`,
      args,
    )
    return NextResponse.json({ assessments: rows })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const ctx = await requireApiSession()
  if (ctx instanceof NextResponse) return ctx
  const practiceId = await getEffectivePracticeId(null, { email: ctx.session.email, id: ctx.user.id })
  if (!practiceId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { patient_name, patient_phone, assessment_type } = await req.json()
    const token = randomBytes(24).toString('hex')
    const { rows } = await pool.query(
      `INSERT INTO outcome_assessments
          (practice_id, patient_name, patient_phone, assessment_type, token)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *`,
      [practiceId, patient_name, patient_phone, assessment_type, token],
    )
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://harborreceptionist.com'
    return NextResponse.json({
      assessment: rows[0],
      assessment_url: `${appUrl}/outcomes/${token}`,
    })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
