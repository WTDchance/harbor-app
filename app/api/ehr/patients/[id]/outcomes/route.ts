// app/api/ehr/patients/[id]/outcomes/route.ts
//
// Wave 41 / T3 — longitudinal assessment data for one patient.
//
// Returns every instrument's complete history, plus the clinical
// norms (mean, SD, MCID, reliable change) so the client can render
// severity bands + threshold lines without bundling lib/ehr/norms.ts.
//
// Filterable by date range via ?from=YYYY-MM-DD & ?to=YYYY-MM-DD
// (defaults: last 12 months).

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
import { NORMS, getNorm } from '@/lib/ehr/norms'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Map raw assessment_type to a normalized instrument id matching NORMS.
function normalizeInstrument(raw: string): string | null {
  const t = (raw || '').toUpperCase().replace(/[^A-Z0-9-]/g, '')
  if (t === 'PHQ9' || t === 'PHQ-9' || t === 'PHQ9_GAD7_INTAKE') return 'PHQ-9'
  if (t === 'GAD7' || t === 'GAD-7') return 'GAD-7'
  if (t === 'PHQ2') return 'PHQ-2'
  if (t === 'GAD2' || t === 'PHQ2_GAD2_PHONE') return 'GAD-2'
  if (t === 'PCL5' || t === 'PCL-5') return 'PCL-5'
  if (t === 'AUDITC' || t === 'AUDIT-C') return 'AUDIT-C'
  if (t === 'DAST10' || t === 'DAST-10' || t === 'DAST') return 'DAST-10'
  return null
}

// Severity bands per instrument — used to render coloured background
// bands on the line chart. Pulled from public clinical reference
// material; thresholds match standard scoring keys.
const SEVERITY_BANDS: Record<string, Array<{ label: string; min: number; max: number; color: string }>> = {
  'PHQ-9': [
    { label: 'Minimal',          min: 0,  max: 4,  color: '#dcfce7' }, // green-100
    { label: 'Mild',             min: 5,  max: 9,  color: '#fef9c3' }, // yellow-100
    { label: 'Moderate',         min: 10, max: 14, color: '#fed7aa' }, // orange-200
    { label: 'Moderately severe',min: 15, max: 19, color: '#fecaca' }, // red-200
    { label: 'Severe',           min: 20, max: 27, color: '#fca5a5' }, // red-300
  ],
  'GAD-7': [
    { label: 'Minimal',  min: 0,  max: 4,  color: '#dcfce7' },
    { label: 'Mild',     min: 5,  max: 9,  color: '#fef9c3' },
    { label: 'Moderate', min: 10, max: 14, color: '#fed7aa' },
    { label: 'Severe',   min: 15, max: 21, color: '#fca5a5' },
  ],
  'PCL-5': [
    { label: 'Below cutoff', min: 0,  max: 32, color: '#dcfce7' },
    { label: 'Probable PTSD',min: 33, max: 80, color: '#fca5a5' },
  ],
  'AUDIT-C': [
    { label: 'Low risk',  min: 0, max: 3,  color: '#dcfce7' },
    { label: 'Hazardous', min: 4, max: 12, color: '#fca5a5' },
  ],
  'DAST-10': [
    { label: 'No problems',         min: 0, max: 0,  color: '#dcfce7' },
    { label: 'Low level',           min: 1, max: 2,  color: '#fef9c3' },
    { label: 'Moderate',            min: 3, max: 5,  color: '#fed7aa' },
    { label: 'Substantial',         min: 6, max: 8,  color: '#fecaca' },
    { label: 'Severe',              min: 9, max: 10, color: '#fca5a5' },
  ],
}

const MAX_SCORE: Record<string, number> = {
  'PHQ-9': 27, 'GAD-7': 21, 'PHQ-2': 6, 'GAD-2': 6,
  'PCL-5': 80, 'AUDIT-C': 12, 'DAST-10': 10,
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id: patientId } = await params

  const sp = req.nextUrl.searchParams
  const fromParam = sp.get('from')
  const toParam = sp.get('to')

  const now = new Date()
  const twelveMonthsAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000)
  const from = fromParam || twelveMonthsAgo.toISOString().slice(0, 10)
  const to = toParam || now.toISOString().slice(0, 10)

  // Verify patient is in this practice (RLS would block otherwise but
  // we want a clean 404 vs. an empty result).
  const pat = await pool.query(
    `SELECT id, first_name, last_name FROM patients
      WHERE id = $1 AND practice_id = $2 AND deleted_at IS NULL LIMIT 1`,
    [patientId, ctx.practiceId],
  )
  if (pat.rows.length === 0) {
    return NextResponse.json({ error: 'Patient not found' }, { status: 404 })
  }

  const { rows } = await pool.query(
    `SELECT id, assessment_type, score, severity, completed_at
       FROM patient_assessments
      WHERE practice_id = $1
        AND patient_id  = $2
        AND status = 'completed'
        AND completed_at IS NOT NULL
        AND completed_at::date >= $3::date
        AND completed_at::date <= $4::date
      ORDER BY completed_at ASC`,
    [ctx.practiceId, patientId, from, to],
  ).catch(() => ({ rows: [] as any[] }))

  // Group by normalized instrument.
  const byInstrument = new Map<string, Array<{ id: string; score: number; severity: string | null; completed_at: string }>>()
  for (const r of rows) {
    const inst = normalizeInstrument(r.assessment_type)
    if (!inst || r.score == null) continue
    const list = byInstrument.get(inst) ?? []
    list.push({
      id: r.id,
      score: r.score,
      severity: r.severity ?? null,
      completed_at: r.completed_at,
    })
    byInstrument.set(inst, list)
  }

  const series = Array.from(byInstrument.entries()).map(([instrument, points]) => ({
    instrument,
    points,
    max_score: MAX_SCORE[instrument] ?? null,
    severity_bands: SEVERITY_BANDS[instrument] ?? [],
    norm: getNorm(instrument),
  }))

  await auditEhrAccess({
    ctx,
    action: 'patient.outcomes.viewed',
    resourceType: 'patient',
    resourceId: patientId,
    details: {
      from,
      to,
      instruments_count: series.length,
      total_points: series.reduce((acc, s) => acc + s.points.length, 0),
    },
  })

  return NextResponse.json({
    patient: { id: patientId, first_name: pat.rows[0].first_name, last_name: pat.rows[0].last_name },
    range: { from, to },
    series,
    norms: NORMS,
  })
}
