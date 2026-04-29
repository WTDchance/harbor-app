// W51 D6 — search SignalWire numbers by area code.
import { NextResponse, type NextRequest } from 'next/server'
import { requireReceptionApiSession } from '@/lib/aws/api-auth'
import { searchAvailableNumbers } from '@/lib/aws/provisioning/signalwire-numbers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const ctx = await requireReceptionApiSession()
  if (ctx instanceof NextResponse) return ctx

  const sp = req.nextUrl.searchParams
  const areaCode = sp.get('area_code') || undefined
  const limit = Math.min(20, Number(sp.get('limit')) || 10)
  try {
    const numbers = await searchAvailableNumbers({ areaCode, limit })
    return NextResponse.json({ numbers })
  } catch (e) {
    return NextResponse.json({ error: 'search_failed', message: (e as Error).message }, { status: 502 })
  }
}
