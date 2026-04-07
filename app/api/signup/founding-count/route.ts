// GET /api/signup/founding-count
// Returns how many founding-member spots are left and what the current price
// should be. Used by the landing page banner and the signup wizard.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

const FOUNDING_CAP = Number(process.env.FOUNDING_MEMBER_CAP || '20')
const FOUNDING_PRICE_CENTS = 19700 // $197
const REGULAR_PRICE_CENTS = 39700 // $397

export async function GET() {
  try {
    // Count active founding practices (those who have paid + been provisioned)
    const { count, error } = await supabaseAdmin
      .from('practices')
      .select('id', { count: 'exact', head: true })
      .eq('founding_member', true)
      .in('status', ['active', 'trial'])

    if (error) {
      console.error('founding-count query failed:', error)
      // Fail open — assume spots are available so we don't block signups.
      return NextResponse.json({
        used: 0,
        cap: FOUNDING_CAP,
        remaining: FOUNDING_CAP,
        is_founding_available: true,
        price_cents: FOUNDING_PRICE_CENTS,
        regular_price_cents: REGULAR_PRICE_CENTS,
      })
    }

    const used = count || 0
    const remaining = Math.max(0, FOUNDING_CAP - used)
    const isAvailable = remaining > 0

    return NextResponse.json({
      used,
      cap: FOUNDING_CAP,
      remaining,
      is_founding_available: isAvailable,
      price_cents: isAvailable ? FOUNDING_PRICE_CENTS : REGULAR_PRICE_CENTS,
      regular_price_cents: REGULAR_PRICE_CENTS,
    })
  } catch (e) {
    console.error('founding-count error:', e)
    return NextResponse.json({
      used: 0,
      cap: FOUNDING_CAP,
      remaining: FOUNDING_CAP,
      is_founding_available: true,
      price_cents: FOUNDING_PRICE_CENTS,
      regular_price_cents: REGULAR_PRICE_CENTS,
    })
  }
}
