import { NextRequest, NextResponse } from 'next/server'
import twilio from 'twilio'

// Public endpoint for signup flow â searches Twilio for available phone numbers
// No auth required since this is called during the signup process
export async function GET(request: NextRequest) {
  try {
    const areaCode = request.nextUrl.searchParams.get('areaCode')

    if (!areaCode || !/^\d{3}$/.test(areaCode)) {
      return NextResponse.json(
        { error: 'Valid 3-digit area code is required' },
        { status: 400 }
      )
    }

    const client = twilio(
      process.env.TWILIO_ACCOUNT_SID!,
      process.env.TWILIO_AUTH_TOKEN!
    )

    const availableNumbers = await client
      .availablePhoneNumbers('US')
      .local.list({
        areaCode: parseInt(areaCode),
        voiceEnabled: true,
        smsEnabled: true,
        limit: 10,
      })

    const results = availableNumbers.map((num) => ({
      phoneNumber: num.phoneNumber,
      friendlyName: num.friendlyName,
      locality: num.locality,
      region: num.region,
    }))

    return NextResponse.json(results)
  } catch (error) {
    console.error('[Available Numbers] Error:', error)
    return NextResponse.json(
      { error: 'Failed to search for available numbers' },
      { status: 500 }
    )
  }
}
