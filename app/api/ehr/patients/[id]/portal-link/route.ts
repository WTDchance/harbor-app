// app/api/ehr/patients/[id]/portal-link/route.ts
// Therapist-side: generate or rotate the portal access token for a patient.
// Returns the full login URL the patient can click.

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireEhrAuth, isAuthError } from '@/lib/ehr/auth'
import { auditEhrAccess } from '@/lib/ehr/audit'
import { newPortalToken } from '@/lib/ehr/portal'

const TOKEN_TTL_DAYS = 30

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireEhrAuth(); if (isAuthError(auth)) return auth
  const { id: patientId } = await params

  const { data: patient } = await supabaseAdmin
    .from('patients').select('id, practice_id').eq('id', patientId).eq('practice_id', auth.practiceId).maybeSingle()
  if (!patient) return NextResponse.json({ error: 'Patient not found' }, { status: 404 })

  const token = newPortalToken()
  const expires = new Date(Date.now() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000)
  const { error } = await supabaseAdmin
    .from('patients')
    .update({ portal_access_token: token, portal_token_expires_at: expires.toISOString() })
    .eq('id', patientId).eq('practice_id', auth.practiceId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const base = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin
  const url = `${base}/portal/login?token=${encodeURIComponent(token)}`

  await auditEhrAccess({
    user: auth.user, practiceId: auth.practiceId, action: 'note.update',
    resourceId: patientId,
    details: { kind: 'portal_token_rotated', expires_at: expires.toISOString() },
    severity: 'warn',
  })

  return NextResponse.json({ url, token, expires_at: expires.toISOString() })
}
