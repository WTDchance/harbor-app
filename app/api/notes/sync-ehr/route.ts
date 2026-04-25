import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireApiSession } from '@/lib/aws/api-auth'

/**
 * POST /api/notes/sync-ehr
 * Sync a session note to the practice's EHR system
 * Body: { note_id }
 */
export async function POST(req: NextRequest) {
  try {
    // supabase client removed (Cognito auth)
  const __ctx = await requireApiSession();
  if (__ctx instanceof NextResponse) return __ctx;
  const user = { id: __ctx.user.id, email: __ctx.session.email };
  if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: practice } = await supabase
      .from('practices')
      .select('id')
      .eq('notification_email', user.email)
      .single()

    if (!practice) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const { note_id } = await req.json()

    if (!note_id) {
      return NextResponse.json(
        { error: 'note_id is required' },
        { status: 400 }
      )
    }

    // Update the note with pending EHR sync status
    const { error } = await supabaseAdmin
      .from('session_notes')
      .update({
        ehr_synced: false,
        ehr_system: 'pending',
        updated_at: new Date().toISOString(),
      })
      .eq('id', note_id)
      .eq('practice_id', practice.id)

    if (error) {
      throw error
    }

    // Return pending status
    return NextResponse.json({
      status: 'pending',
      message: 'EHR integration coming soon. Your note has been saved and will sync automatically once your EHR API is connected.',
    })
  } catch (error: any) {
    console.error('Error syncing to EHR:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
