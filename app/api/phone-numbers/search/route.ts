import { NextRequest, NextResponse } from 'next/server'
import { searchAvailableNumbers } from '@/lib/aws/provisioning/signalwire-numbers'

// Wave 41 — search SignalWire's pool for available US local numbers.
// Public endpoint used by the signup flow before the user has an account.
//
// SignalWire's LaML AvailablePhoneNumbers endpoint accepts an AreaCode
// param. Locality/region narrowing isn't supported by SignalWire's
// search the way Twilio's was; we still accept the params for API
// back-compat and simply scope by area-code if present.
export async function POST(req: NextRequest) {
  try {
    const { area_code, city, state, zip_code } = await req.json()

    if (!area_code && !city && !state && !zip_code) {
      return NextResponse.json(
        { error: 'Must provide at least one search parameter: area_code, city, state, or zip_code' },
        { status: 400 }
      )
    }

    const numbers = await searchAvailableNumbers({
      areaCode: area_code ? String(area_code) : undefined,
      limit: 10,
    })

    // Optional client-side filter by region if `state` came in without
    // area_code — SignalWire returns the region on each row, so we can
    // narrow without a second call.
    let filtered = numbers
    if (state && !area_code) {
      const target = String(state).toUpperCase()
      filtered = numbers.filter(n => (n.region || '').toUpperCase() === target)
    }

    const results = filtered.map(n => ({
      phoneNumber: n.phoneNumber,
      friendlyName: n.friendlyName,
      locality: n.locality,
      region: n.region,
      postalCode: '',
    }))

    console.log(`[Phone Numbers Search] Found ${results.length} available numbers`, {
      searchParams: { area_code, city, state, zip_code },
    })

    return NextResponse.json({ results }, { status: 200 })
  } catch (error) {
    console.error('[Phone Numbers Search] Error:', error)
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: 'Invalid JSON in request body' }, { status: 400 })
    }
    return NextResponse.json(
      { error: 'Failed to search for phone numbers' },
      { status: 500 }
    )
  }
}
