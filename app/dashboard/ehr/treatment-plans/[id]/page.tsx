// app/dashboard/ehr/treatment-plans/[id]/page.tsx
// Full editor for a treatment plan. Server-renders the current state,
// hands off to the client-side editor for the interactive bits.

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { ChevronLeft } from 'lucide-react'
import { supabaseAdmin } from '@/lib/supabase'
import { getEffectivePracticeId } from '@/lib/active-practice'
import { TreatmentPlanEditor } from '@/components/ehr/TreatmentPlanEditor'

export const dynamic = 'force-dynamic'

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: {
      getAll() { return cookieStore.getAll() },
      setAll(cs) { try { cs.forEach(({ name, value, options }: any) => cookieStore.set(name, value, options)) } catch {} },
    } },
  )
  const { data: { user } } = await supabase.auth.getUser()
  const practiceId = await getEffectivePracticeId(supabaseAdmin, user)

  const { data: plan } = await supabaseAdmin
    .from('ehr_treatment_plans').select('*').eq('id', id).eq('practice_id', practiceId!).maybeSingle()
  if (!plan) return notFound()

  const { data: patient } = await supabaseAdmin
    .from('patients').select('id, first_name, last_name').eq('id', plan.patient_id).maybeSingle()

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
