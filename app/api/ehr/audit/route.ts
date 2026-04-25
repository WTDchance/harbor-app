// app/api/ehr/audit/route.ts
// Lists recent EHR audit events for the caller's practice. Read-only.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireEhrAuth, isAuthError } from '@/lib/ehr/auth'

export async function GET(req: NextRequest) {
  const auth = await requireEhrAuth(); if (isAuthError(auth)) return auth
  const { searchParams } = new URL(req.url)
  const limit = Math.min(parseInt(searchParams.get('limit') || '200', 10) || 200, 1000)
  const action = searchParams.get('action')
  const resourceId = searchParams.get('resource_id')
  const since = searchParams.get('since') // ISO

  let q = supabaseAdmin
    .from('audit_logs')
    .select('id, timestamp, user_id, user_email, action, resource_type, resource_id, details, severity')
    .eq('practice_id', auth.practiceId)
    .eq('resource_type', 'ehr_progress_note')
    .order('timestamp', { ascending: false })
    .limit(limit)
  if (action) q = q.eq('action', action)
  if (resourceId) q = q.eq('resource_id', resourceId)
  if (since) q = q.gte('timestamp', since)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ events: data })
}
