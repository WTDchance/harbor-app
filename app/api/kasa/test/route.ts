import { NextRequest, NextResponse } from 'next/server'
import { testConnection, triggerCheckinNotification } from '@/lib/kasa'

// POST /api/kasa/test
// Test Kasa connection and optionally trigger a device
// Body: { email, password, deviceAlias?, trigger?: boolean, autoOffMinutes?: number }
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { email, password, deviceAlias, trigger, autoOffMinutes } = body

    if (!email || !password) {
      return NextResponse.json(
        { error: 'email and password are required' },
        { status: 400 }
      )
    }

    // If trigger mode — actually turn on the device
    if (trigger && deviceAlias) {
      const result = await triggerCheckinNotification(
        'test-practice',
        email,
        password,
        deviceAlias,
        autoOffMinutes || 1 // Default to 1 min for testing
      )
      return NextResponse.json(result)
    }

    // Otherwise just test connection and list devices
    const result = await testConnection(email, password)
    return NextResponse.json(result)
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Test failed' },
      { status: 500 }
    )
  }
}
