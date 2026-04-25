import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

/**
 * GET /api/notes
 * Return all session notes for the logged-in practice
 */
export async function GET(req: NextRequest) {
  try {
    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll()
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              )
            } catch {
              // Middleware will handle this
            }
          },
        },
      }
    )

    const { data: { user } } = await supabase.auth.getUser()
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

    const { data: notes } = await supabaseAdmin
      .from('session_notes')
      .select('*')
      .eq('practice_id', practice.id)
      .order('session_date', { ascending: false })
      .order('created_at', { ascending: false })

    return NextResponse.json({ notes: notes || [] })
  } catch (error: any) {
    console.error('Error fetching session notes:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/notes
 * Create a new session note
 * Body: { patient_name?, patient_phone?, session_date?, note_text, audio_url? }
 */
export async function POST(req: NextRequest) {
  try {
    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll()
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              )
            } catch {
              // Middleware will handle this
            }
          },
        },
      }
    )

    const { data: { user } } = await supabase.auth.getUser()
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

    const { patient_name, patient_phone, session_date, note_text, audio_url, note_format } = await req.json()

    if (!note_text) {
      return NextResponse.json(
        { error: 'note_text is required' },
        { status: 400 }
      )
    }

    const { data: note, error } = await supabaseAdmin
      .from('session_notes')
      .insert({
        practice_id: practice.id,
        patient_name: patient_name || null,
        patient_phone: patient_phone || null,
        session_date: session_date || new Date().toISOString().split('T')[0],
        note_text,
        audio_url: audio_url || null,
        note_format: note_format || 'raw',
        transcription_model: 'whisper',
      })
      .select()
      .single()

    if (error) {
      throw error
    }

    return NextResponse.json({ note })
  } catch (error: any) {
    console.error('Error creating session note:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
