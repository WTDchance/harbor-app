import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { email, source, missed_calls_per_week, estimated_annual_loss } = body

    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      return NextResponse.json({ error: 'Valid email required' }, { status: 400 })
    }

    // Upsert lead — don't create duplicates
    const { error } = await supabase
      .from('leads')
      .upsert(
        {
          email: email.toLowerCase(),
          source: source || 'unknown',
          missed_calls_per_week: missed_calls_per_week || null,
          estimated_annual_loss: estimated_annual_loss || null,
          captured_at: new Date().toISOString(),
        },
        { onConflict: 'email' }
      )

    if (error) {
      console.error('Lead capture error:', error)
      // Still return 200 — don't let DB errors leak to user
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: true }) // fail silently from user perspective
  }
}
