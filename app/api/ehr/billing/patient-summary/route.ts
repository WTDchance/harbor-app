// app/api/ehr/billing/patient-summary/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { requireEhrAuth, isAuthError } from '@/lib/ehr/auth'
import { patientBillingSummary } from '@/lib/ehr/billing'

export async function GET(req: NextRequest) {
  const auth = await requireEhrAuth(); if (isAuthError(auth)) return auth
  const { searchParams } = new URL(req.url)
  const patientId = searchParams.get('patient_id')
  if (!patientId) return NextResponse.json({ error: 'patient_id required' }, { status: 400 })
  try {
    const summary = await patientBillingSummary(auth.practiceId, patientId)
    return NextResponse.json(summary)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 })
  }
}
