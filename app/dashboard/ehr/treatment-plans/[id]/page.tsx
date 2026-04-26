// app/dashboard/ehr/treatment-plans/[id]/page.tsx
//
// Wave 21 (AWS port). Server component — Cognito + pool.

import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { pool } from '@/lib/aws/db'
import { getEffectivePracticeId } from '@/lib/active-practice'
import { TreatmentPlanEditor } from '@/components/ehr/TreatmentPlanEditor'

export const dynamic = 'force-dynamic'

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const practiceId = await getEffectivePracticeId(null)
  if (!practiceId) redirect('/dashboard')

  const { rows: planRows } = await pool.query(
    `SELECT * FROM ehr_treatment_plans WHERE id = $1 AND practice_id = $2 LIMIT 1`,
    [id, practiceId],
  )
  const plan = planRows[0]
  if (!plan) return notFound()

  const { rows: patientRows } = await pool.query<{ id: string; first_name: string; last_name: string }>(
    `SELECT id, first_name, last_name FROM patients
      WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [plan.patient_id],
  )
  const patient = patientRows[0] ?? null

  return (
    <div className="max-w-3xl mx-auto py-8 px-4">
      <Link
        href={patient ? `/dashboard/patients/${patient.id}` : '/dashboard/patients'}
        className="inline-flex items-center gap-1 text-sm text-teal-700 hover:text-teal-900 mb-4"
      >
        <ChevronLeft className="w-4 h-4" />
        Back to {patient ? `${patient.first_name} ${patient.last_name}` : 'patients'}
      </Link>

      <h1 className="text-2xl font-semibold text-gray-900 mb-1">{plan.title}</h1>
      <div className="text-xs text-gray-500 mb-6 uppercase tracking-wide">
        Status: {plan.status}
        {patient && <> · Patient: {patient.first_name} {patient.last_name}</>}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <TreatmentPlanEditor initial={plan} />
      </div>
    </div>
  )
}
