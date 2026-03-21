// Vapi.ai webhook handler
// Receives events from Vapi for incoming calls
// Events: call-started, transcript, call-ended, function-call


import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { generateCallSummary } from '@/lib/claude'
import { getCallSummaryPrompt } from '@/lib/ai-prompts'
import { sendEmail, buildCallSummaryEmail } from '@/lib/email'
import type { VapiWebhookPayload } from '@/types'
import twilio from 'twilio'


const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER


// Crisis keywords to detect in transcripts
const CRISIS_KEYWORDS = [
  'suicide',
  'kill myself',
  'end my life',
  'hurt myself',
  'self-harm',
  "don't want to be here",
  'overdose',
  'crisis',
  'not worth living',
]


/**
 * POST /api/vapi/webhook
 * Handles incoming Vapi webhook events
 */
export async function POST(request: NextRequest) {
  try {
    // Validate webhook secret
    const secret = request.nextUrl.searchParams.get('secret')
    if (process.env.VAPI_WEBHOOK_SECRET && secret !== process.env.VAPI_WEBHOOK_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const payload: VapiWebhookPayload = await request.json()
