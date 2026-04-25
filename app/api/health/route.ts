import { NextResponse } from 'next/server'

// Lightweight liveness probe.
// - Returns 200 when the Next.js process is up and responding
// - Echoes the build SHA so we can confirm which commit ECS is serving
// - Reports presence (not value) of critical envs so we can spot wiring gaps
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    commit: process.env.GIT_SHA || process.env.SOURCE_COMMIT || 'unknown',
    env: process.env.NODE_ENV,
    uptimeSec: Math.round(process.uptime()),
    wired: {
      supabase: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
      stripe: Boolean(process.env.STRIPE_SECRET_KEY),
      twilio: Boolean(process.env.TWILIO_ACCOUNT_SID),
      vapi: Boolean(process.env.VAPI_API_KEY),
      resend: Boolean(process.env.RESEND_API_KEY),
      anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
      pg_host: Boolean(process.env.PGHOST),
    },
  })
}
