// POST /api/ehr/simplepractice
// EHR integration endpoint for SimplePractice
// Creates referral notes from Harbor call data

import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    // Log the payload for debugging
    console.log('[SimplePractice EHR Integration]', {
      timestamp: new Date().toISOString(),
      payload: body,
    })

    // For now, just return success
    // Future: Wire up OAuth with SimplePractice API
    return NextResponse.json({
      received: true,
      message: 'EHR integration pending — SimplePractice API access coming soon',
    })
  } catch (error) {
    console.error('Error in SimplePractice EHR integration:', error)
    return NextResponse.json(
      { error: 'Failed to process EHR request' },
      { status: 500 }
    )
  }
}

export async function GET() {
  return NextResponse.json({
    endpoint: 'POST /api/ehr/simplepractice',
    description: 'EHR integration stub for SimplePractice (coming soon)',
    status: 'pending',
  })
}
