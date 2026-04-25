// app/api/ehr/consents/[id]/route.ts — sign / revoke an existing consent.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireEhrAuth, isAuthError } from '@/lib/ehr/auth'
import { auditEhrAccess } from '@/lib/ehr/audit'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireEhrAuth(); if (isAuthError(auth)) return auth
  const { id } = await params
  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const patch: any = {}
  if (body.action === 'sign') {
    patch.status = 'signed'
    patch.signed_at = new Date().toISOString()
    patch.signed_by_name = body.signed_by_name || 'Patient'
    patch.signed_method = body.signed_method || 'in_person'
  } else if (body.action === 'revoke') {
    patch.status = 'revoked'
    patch.revoked_at = new Date().toISOString()
    patch.revoked_reason = body.revoked_reason ?? null
  } else {
    return NextResponse.json({ error: 'action must be "sign" or "revoke"' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('ehr_consents').update(patch).eq('id', id).eq('practice_id', auth.practiceId).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  await auditEhrAccess({
    user: auth.user, practiceId: auth.practiceId, action: 'note.update',
    resourceId: id, details: { kind: 'consent', action: body.action },
    severity: body.action === 'revoke' ? 'warn' : 'info',
  })
  return NextResponse.json({ consent: data })
}
