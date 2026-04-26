// app/api/patients/[id]/communication-prefs/route.ts
//
// Wave 23 (AWS port). Per-patient SMS / email / call opt-out state.
// Backed by sms_opt_outs / email_opt_outs / call_opt_outs tables
// keyed by (practice_id, phone) or (practice_id, email). Raw SQL so
// we don't drag in the Supabase-coupled lib/sms-optout +
// lib/call-optout helpers (those are Bucket 5 carrier libs).

import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/aws/db'
import { requireApiSession } from '@/lib/aws/api-auth'
import { getEffectivePracticeId } from '@/lib/active-practice'

async function readPatient(patientId: string, practiceId: string) {
  const { rows } = await pool.query(
    `SELECT id, practice_id, phone, email FROM patients
      WHERE id = $1 AND practice_id = $2 AND deleted_at IS NULL LIMIT 1`,
    [patientId, practiceId],
  )
  return rows[0] ?? null
}

async function readPrefs(practiceId: string, phone: string | null, email: string | null) {
  const tasks: Promise<any>[] = []
  tasks.push(
    phone
      ? pool
          .query(
            `SELECT 1 FROM sms_opt_outs
              WHERE practice_id = $1 AND phone = $2 LIMIT 1`,
            [practiceId, phone],
          )
          .then((r) => (r.rowCount ?? 0) > 0)
          .catch(() => false)
      : Promise.resolve(false),
  )
  tasks.push(
    email
      ? pool
          .query(
            `SELECT 1 FROM email_opt_outs
              WHERE practice_id = $1 AND email = $2 LIMIT 1`,
            [practiceId, email],
          )
          .then((r) => (r.rowCount ?? 0) > 0)
          .catch(() => false)
      : Promise.resolve(false),
  )
  tasks.push(
    phone
      ? pool
          .query(
            `SELECT 1 FROM call_opt_outs
              WHERE practice_id = $1 AND phone = $2 LIMIT 1`,
            [practiceId, phone],
          )
          .then((r) => (r.rowCount ?? 0) > 0)
          .catch(() => false)
      : Promise.resolve(false),
  )
  const [smsOut, emailOut, callOut] = await Promise.all(tasks)
  return {
    sms_opted_out: !!smsOut,
    email_opted_out: !!emailOut,
    call_opted_out: !!callOut,
    phone,
    email,
  }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id } = await params

  const practiceId = await getEffectivePracticeId(null, { email: ctx.session.email, id: ctx.user.id })
  if (!practiceId) return NextResponse.json({ error: 'Practice not found' }, { status: 404 })

  const patient = await readPatient(id, practiceId)
  if (!patient) return NextResponse.json({ error: 'Patient not found' }, { status: 404 })

  return NextResponse.json(await readPrefs(practiceId, patient.phone, patient.email))
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id } = await params

  const practiceId = await getEffectivePracticeId(null, { email: ctx.session.email, id: ctx.user.id })
  if (!practiceId) return NextResponse.json({ error: 'Practice not found' }, { status: 404 })

  const patient = await readPatient(id, practiceId)
  if (!patient) return NextResponse.json({ error: 'Patient not found' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const { phone, email } = patient

  if (typeof body.sms_opted_out === 'boolean') {
    if (!phone) {
      return NextResponse.json(
        { error: 'Cannot change SMS opt-out: patient has no phone number on file.' },
        { status: 400 },
      )
    }
    if (body.sms_opted_out) {
      await pool.query(
        `INSERT INTO sms_opt_outs (practice_id, phone, keyword, source)
         VALUES ($1, $2, 'DASHBOARD', 'dashboard')
         ON CONFLICT (practice_id, phone) DO UPDATE
           SET keyword = EXCLUDED.keyword, source = EXCLUDED.source`,
        [practiceId, phone],
      )
    } else {
      await pool.query(
        `DELETE FROM sms_opt_outs WHERE practice_id = $1 AND phone = $2`,
        [practiceId, phone],
      )
    }
  }

  if (typeof body.email_opted_out === 'boolean') {
    if (!email) {
      return NextResponse.json(
        { error: 'Cannot change email opt-out: patient has no email on file.' },
        { status: 400 },
      )
    }
    if (body.email_opted_out) {
      await pool.query(
        `INSERT INTO email_opt_outs (practice_id, email, source)
         VALUES ($1, $2, 'dashboard')
         ON CONFLICT (practice_id, email) DO UPDATE SET source = EXCLUDED.source`,
        [practiceId, email],
      )
    } else {
      await pool.query(
        `DELETE FROM email_opt_outs WHERE practice_id = $1 AND email = $2`,
        [practiceId, email],
      )
    }
  }

  if (typeof body.call_opted_out === 'boolean') {
    if (!phone) {
      return NextResponse.json(
        { error: 'Cannot change call opt-out: patient has no phone number on file.' },
        { status: 400 },
      )
    }
    if (body.call_opted_out) {
      await pool.query(
        `INSERT INTO call_opt_outs (practice_id, phone, source)
         VALUES ($1, $2, 'dashboard')
         ON CONFLICT (practice_id, phone) DO UPDATE SET source = EXCLUDED.source`,
        [practiceId, phone],
      )
    } else {
      await pool.query(
        `DELETE FROM call_opt_outs WHERE practice_id = $1 AND phone = $2`,
        [practiceId, phone],
      )
    }
  }

  return NextResponse.json(await readPrefs(practiceId, phone, email))
}
