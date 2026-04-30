// W52 D2 — patient submits responses; we score + persist + maybe escalate.
import { NextResponse, type NextRequest } from 'next/server'
import { randomBytes } from 'node:crypto'
import { pool } from '@/lib/aws/db'
import { writeAuditLog, extractIp } from '@/lib/audit'
import { scoreAssessment, type AssessmentResponse } from '@/lib/ehr/assessments'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!token || !token.startsWith('asm_')) return NextResponse.json({ error: 'invalid_token' }, { status: 400 })

  const body = await req.json().catch(() => null) as { responses?: AssessmentResponse[] } | null
  const responses = Array.isArray(body?.responses) ? body!.responses : []
  if (responses.length === 0) return NextResponse.json({ error: 'responses_required' }, { status: 400 })

  const r = await pool.query(
    `SELECT a.id, a.practice_id, a.patient_id, a.lead_id, a.assessment_slug, a.status,
            a.expires_at, d.questions, d.scoring_rules
       FROM assessment_administrations a
       JOIN assessment_definitions d ON d.slug = a.assessment_slug
      WHERE a.portal_token = $1 LIMIT 1`,
    [token],
  )
  if (r.rows.length === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const row = r.rows[0]
  if (row.status === 'completed') return NextResponse.json({ error: 'already_completed' }, { status: 409 })
  if (new Date(row.expires_at) < new Date()) return NextResponse.json({ error: 'expired' }, { status: 410 })

  const scored = scoreAssessment({ questions: row.questions, scoring_rules: row.scoring_rules }, responses)

  const ip = extractIp(req.headers)
  const ua = req.headers.get('user-agent')
  await pool.query(
    `UPDATE assessment_administrations
        SET status = 'completed', responses = $1::jsonb, raw_score = $2,
            computed_score = $3::jsonb, crisis_flagged = $4, completed_at = NOW()
      WHERE id = $5`,
    [
      JSON.stringify(responses), scored.raw_score,
      JSON.stringify({ severity_label: scored.severity_label, crisis_reasons: scored.crisis_reasons }),
      scored.crisis_flagged, row.id,
    ],
  )

  await writeAuditLog({
    practice_id: row.practice_id,
    action: 'assessment.completed',
    resource_type: 'assessment_administration',
    resource_id: row.id,
    severity: scored.crisis_flagged ? 'critical' : 'info',
    details: {
      slug: row.assessment_slug, raw_score: scored.raw_score,
      severity_label: scored.severity_label,
      crisis_flagged: scored.crisis_flagged,
      crisis_reasons: scored.crisis_reasons,
    },
    ip_address: ip, user_agent: ua,
  })

  // Escalation: positive PHQ-2/GAD-2 → auto-send the longer instrument.
  let escalated_to: string | null = null
  if (row.patient_id && scored.escalate_to) {
    const newToken = 'asm_' + randomBytes(24).toString('base64url')
    const ins = await pool.query(
      `INSERT INTO assessment_administrations
         (practice_id, patient_id, assessment_slug, administered_via, portal_token)
       VALUES ($1, $2, $3, 'sms_link', $4)
       RETURNING id`,
      [row.practice_id, row.patient_id, scored.escalate_to, newToken],
    ).catch(() => ({ rows: [] as any[] }))
    if (ins.rows[0]) escalated_to = scored.escalate_to
  }

  // Crisis row + practice-owner alert (best-effort).
  if (scored.crisis_flagged) {
    await pool.query(
      `INSERT INTO crisis_alerts (practice_id, patient_id, alert_kind, summary, created_at)
       VALUES ($1, $2, 'assessment_crisis_trigger', $3, NOW())
       ON CONFLICT DO NOTHING`,
      [row.practice_id, row.patient_id, `${row.assessment_slug.toUpperCase()} crisis trigger fired. Review immediately.`],
    ).catch(() => null)

    await writeAuditLog({
      practice_id: row.practice_id,
      action: 'assessment.crisis_triggered',
      resource_type: 'assessment_administration',
      resource_id: row.id,
      severity: 'critical',
      details: { slug: row.assessment_slug, reasons: scored.crisis_reasons },
    })
  }

  return NextResponse.json({
    ok: true, raw_score: scored.raw_score,
    severity_label: scored.severity_label,
    crisis_flagged: scored.crisis_flagged,
    escalated_to,
  })
}
