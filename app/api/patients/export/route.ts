// app/api/patients/export/route.ts
//
// Wave 19 (AWS port). Practice-level patient list export as CSV in
// one of four supported formats: simplepractice, therapynotes, jane,
// harbor (default). The therapist downloads this from the dashboard
// to bulk-import their roster into another EHR.
//
// Read-only. Cognito + RDS pool. Practice-scoped via requireApiSession.
//
// Schema mappings vs. legacy:
//   Legacy queried intake_forms with denormalized patient_* fields.
//   AWS canonical is normalized — patients holds first/last_name +
//   email + phone + DOB + address; assessment scores come from
//   patient_assessments.score with the latest PHQ-9 / GAD-7 picked
//   per patient via DISTINCT ON.
//
// Audit captures admin/clinician email + format + row_count.

import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/aws/db'
import { requireApiSession } from '@/lib/aws/api-auth'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

function escapeCsv(val: string | null | undefined): string {
  if (val === null || val === undefined) return ''
  const s = String(val)
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

function row(values: (string | null | undefined)[]): string {
  return values.map(escapeCsv).join(',')
}

function formatDob(iso: string | Date | null): string {
  if (!iso) return ''
  const d = iso instanceof Date ? iso : new Date(iso)
  if (isNaN(d.getTime())) return String(iso)
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  return `${mm}/${dd}/${d.getUTCFullYear()}`
}

function formatDate(iso: string | Date | null): string {
  if (!iso) return ''
  const d = iso instanceof Date ? iso : new Date(iso)
  if (isNaN(d.getTime())) return ''
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${mm}/${dd}/${d.getFullYear()}`
}

export async function GET(req: NextRequest) {
  const ctx = await requireApiSession()
  if (ctx instanceof NextResponse) return ctx
  if (!ctx.practiceId) {
    return NextResponse.json({ error: 'Practice not found' }, { status: 404 })
  }

  const { searchParams } = new URL(req.url)
  const format = searchParams.get('format') ?? 'harbor'

  // Fetch all non-deleted patients for the practice.
  const { rows: patients } = await pool.query(
    `SELECT id, first_name, last_name, email, phone, date_of_birth,
            address_line_1, city, state, postal_code, created_at
       FROM patients
      WHERE practice_id = $1 AND deleted_at IS NULL
      ORDER BY last_name NULLS LAST, first_name NULLS LAST`,
    [ctx.practiceId],
  )

  // Per-patient latest PHQ-9 + GAD-7 + intake count + last_seen.
  const ids = patients.map((p) => p.id)
  const assessmentsByPatient = new Map<string, { phq9?: any; gad7?: any }>()
  if (ids.length > 0) {
    const { rows: assessments } = await pool.query(
      `SELECT DISTINCT ON (patient_id, assessment_type)
              patient_id, assessment_type, score, severity, completed_at
         FROM patient_assessments
        WHERE practice_id = $1
          AND patient_id = ANY($2::uuid[])
          AND assessment_type IN ('phq9','gad7')
          AND status = 'completed'
        ORDER BY patient_id, assessment_type,
                 completed_at DESC NULLS LAST, created_at DESC`,
      [ctx.practiceId, ids],
    )
    for (const a of assessments) {
      const existing = assessmentsByPatient.get(a.patient_id) ?? {}
      if (a.assessment_type === 'phq9') existing.phq9 = a
      if (a.assessment_type === 'gad7') existing.gad7 = a
      assessmentsByPatient.set(a.patient_id, existing)
    }
  }

  const intakeCountByPatient = new Map<string, number>()
  const lastSeenByPatient = new Map<string, string>()
  if (ids.length > 0) {
    const { rows: counts } = await pool.query(
      `SELECT patient_id, COUNT(*)::int AS c, MAX(completed_at) AS last_completed
         FROM intake_forms
        WHERE practice_id = $1 AND patient_id = ANY($2::uuid[])
          AND completed_at IS NOT NULL
        GROUP BY patient_id`,
      [ctx.practiceId, ids],
    )
    for (const c of counts) {
      intakeCountByPatient.set(c.patient_id, c.c)
      if (c.last_completed) lastSeenByPatient.set(c.patient_id, c.last_completed)
    }
  }

  const lines: string[] = []

  switch (format) {
    case 'simplepractice': {
      lines.push(
        row([
          'First Name',
          'Last Name',
          'Email Address',
          'Phone Number',
          'Date of Birth',
          'Street',
          'City',
          'State',
          'Zip Code',
        ]),
      )
      for (const p of patients) {
        lines.push(
          row([
            p.first_name,
            p.last_name,
            p.email,
            p.phone,
            formatDob(p.date_of_birth),
            p.address_line_1,
            p.city,
            p.state,
            p.postal_code,
          ]),
        )
      }
      break
    }
    case 'therapynotes': {
      lines.push(
        row([
          'First Name',
          'Last Name',
          'Date of Birth',
          'Email',
          'Phone',
          'Address1',
          'City',
          'State',
          'Zip',
        ]),
      )
      for (const p of patients) {
        lines.push(
          row([
            p.first_name,
            p.last_name,
            formatDob(p.date_of_birth),
            p.email,
            p.phone,
            p.address_line_1,
            p.city,
            p.state,
            p.postal_code,
          ]),
        )
      }
      break
    }
    case 'jane': {
      lines.push(
        row([
          'First Name',
          'Last Name',
          'Email',
          'Mobile Phone',
          'Date of Birth',
          'Address Line 1',
          'City',
          'Province',
          'Postal Code',
        ]),
      )
      for (const p of patients) {
        lines.push(
          row([
            p.first_name,
            p.last_name,
            p.email,
            p.phone,
            formatDob(p.date_of_birth),
            p.address_line_1,
            p.city,
            p.state,
            p.postal_code,
          ]),
        )
      }
      break
    }
    default: {
      lines.push(
        row([
          'Full Name',
          'First Name',
          'Last Name',
          'Email',
          'Phone',
          'Date of Birth',
          'City',
          'State',
          'Total Intakes',
          'Last Seen',
          'Latest PHQ-9 Score',
          'Latest PHQ-9 Severity',
          'Latest GAD-7 Score',
          'Latest GAD-7 Severity',
        ]),
      )
      for (const p of patients) {
        const a = assessmentsByPatient.get(p.id)
        const fullName = [p.first_name, p.last_name].filter(Boolean).join(' ')
        lines.push(
          row([
            fullName,
            p.first_name,
            p.last_name,
            p.email,
            p.phone,
            formatDob(p.date_of_birth),
            p.city,
            p.state,
            String(intakeCountByPatient.get(p.id) ?? 0),
            formatDate(lastSeenByPatient.get(p.id) ?? null),
            a?.phq9?.score != null ? String(a.phq9.score) : '',
            a?.phq9?.severity ?? '',
            a?.gad7?.score != null ? String(a.gad7.score) : '',
            a?.gad7?.severity ?? '',
          ]),
        )
      }
      break
    }
  }

  await auditEhrAccess({
    ctx,
    action: 'patients.export',
    resourceType: 'practice',
    resourceId: ctx.practiceId,
    details: { format, row_count: patients.length },
  })

  const csv = lines.join('\r\n')
  const filename = `harbor-patients-${format}-${new Date().toISOString().slice(0, 10)}.csv`

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
