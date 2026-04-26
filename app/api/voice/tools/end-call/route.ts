// app/api/voice/tools/end-call/route.ts
//
// Wave 27c — Retell tool: graceful end-call signal. Retell handles the
// actual call termination internally when its built-in `end_call` tool
// fires; this URL is here to satisfy the tool's `url` field — we just
// 200 OK back so Retell knows our side accepted the signal.
//
// Auditing happens on the lifecycle webhook (call_ended).

import { NextRequest, NextResponse } from 'next/server'
import { parseRetellToolCall, toolResult } from '@/lib/aws/voice/auth'

export async function POST(req: NextRequest) {
  const ctx = await parseRetellToolCall(req)
  if (ctx instanceof NextResponse) return ctx
  return toolResult('Goodbye.')
}
