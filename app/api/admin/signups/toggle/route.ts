import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase'

// POST /api/admin/signups/toggle
// Body: { enabled: boolean }
// Flips the global signups_enabled kill switch. Admin-only.
export async function POST(request: NextRequest) {
  try {
    const supabase = createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminEmail = process.env.ADMIN_EMAIL
    if (!adminEmail || user.email !== adminEmail) {
      return NextResponse.json({ error: 'Forbidden — admin only' }, { status: 403 })
    }

    const body = await request.json().catch(() => ({}))
    const enabled = body?.enabled === true

    const { error: upsertError } = await supabaseAdmin
      .from('app_settings')
      .upsert(
        {
          key: 'signups_enabled',
          value: enabled,
          updated_at: new Date().toISOString(),
          updated_by: user.id,
        },
        { onConflict: 'key' }
      )

    if (upsertError) {
      console.error('[admin/signups/toggle] upsert error:', upsertError)
      return NextResponse.json({ error: 'Failed to update setting' }, { status: 500 })
    }

    console.log(`[admin/signups/toggle] ${user.email} set signups_enabled=${enabled}`)

    return NextResponse.json({ success: true, signups_enabled: enabled })
  } catch (err) {
    console.error('[admin/signups/toggle] unhandled error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
