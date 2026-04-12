import { NextRequest, NextResponse } from 'next/server'
import twilio from 'twilio'

export async function POST(req: NextRequest) {
  try {
    // No auth required — this is a read-only Twilio search used during signup
    // before the user has an account

    // Parse request body
    const { area_code, city, state, zip_code } = await req.json()

    // Validate that at least one search parameter is provided
    if (!area_code && !city && !state && !zip_code) {
      return NextResponse.json(
        { error: 'Must provide at least one search parameter: area_code, city, state, or zip_code' },
        { status: 400 }
      )
    }

    // Initialize Twilio client
    const client = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!)

    // Build search options
    const searchOptions: Record<string, any> = {
      voiceEnabled: true,
      smsEnabled: true,
      limit: 10,
    }

    if (area_code) {
      searchOptions.areaCode = area_code
    }

    if (city && state) {
      searchOptions.inLocality = city
      searchOptions.inRegion = state
    } else if (state) {
      searchOptions.inRegion = state
    }

    if (zip_code) {
      searchOptions.inPostalCode = zip_code
    }

    // Search for available phone numbers
    const availableNumbers = await client.availablePhoneNumbers('US').local.list(searchOptions)

    if (!availableNumbers || availableNumbers.length === 0) {
      return NextResponse.json(
        {
          message: 'No available phone numbers found for the given criteria',
          results: [],
        },
        { status: 200 }
      )
    }

    // Format results
    const results = availableNumbers.map((num) => ({
      phoneNumber: num.phoneNumber,
      friendlyName: num.friendlyName,
      locality: num.locality,
      region: num.region,
      postalCode: num.postalCode,
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
