import { NextRequest, NextResponse } from 'next/server'
import { searchAvailableNumbers } from '@/lib/aws/provisioning/signalwire-numbers'

// Public endpoint used by the signup flow before the user has an account.
//
// SignalWire's LaML AvailablePhoneNumbers endpoint is Twilio-compatible
// and accepts AreaCode, InRegion (2-letter state), InLocality (city),
// and InPostalCode in any combination (ANDed).
//
// Both POST (used by the picker UI) and GET (used for ad-hoc curl
// verification) are supported.

const PAGE_SIZE = 10

interface SearchInput {
  area_code?: string | null
  city?: string | null
  state?: string | null
  zip_code?: string | null
  page?: number | string | null
}

async function runSearch(input: SearchInput) {
  const areaCode = input.area_code ? String(input.area_code).trim() : ''
  const city = input.city ? String(input.city).trim() : ''
  const state = input.state ? String(input.state).trim() : ''
  const zip = input.zip_code ? String(input.zip_code).trim() : ''
  const pageNum = (() => {
    const n = Number(input.page ?? 0)
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
  })()

  if (!areaCode && !city && !state && !zip) {
    return {
      status: 400,
      body: {
        error:
          'Must provide at least one search parameter: area_code, city, state, or zip_code',
      },
    }
  }

  const numbers = await searchAvailableNumbers({
    areaCode: areaCode || undefined,
    region: state || undefined,
    locality: city || undefined,
    postalCode: zip || undefined,
    page: pageNum || undefined,
    limit: PAGE_SIZE,
  })

  const results = numbers.map(n => ({
    phoneNumber: n.phoneNumber,
    friendlyName: n.friendlyName,
    locality: n.locality,
    region: n.region,
    postalCode: '',
  }))

  console.log(`[Phone Numbers Search] Found ${results.length} available numbers`, {
    searchParams: { area_code: areaCode, city, state, zip_code: zip, page: pageNum },
  })

  return { status: 200, body: { results } }
}

export async function POST(req: NextRequest) {
  try {
    const json = await req.json().catch(() => ({}))
    const { status, body } = await runSearch(json as SearchInput)
    return NextResponse.json(body, { status })
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

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    const { status, body } = await runSearch({
      area_code: sp.get('area_code'),
      city: sp.get('city'),
      state: sp.get('state'),
      zip_code: sp.get('zip_code'),
      page: sp.get('page'),
    })
    return NextResponse.json(body, { status })
  } catch (error) {
    console.error('[Phone Numbers Search] Error:', error)
    return NextResponse.json(
      { error: 'Failed to search for phone numbers' },
      { status: 500 }
    )
  }
}
