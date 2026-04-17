// Tier 2B: Unified patient communication logger
// Writes to the patient_communications table for every touchpoint.
// Designed to be fire-and-forget (never blocks the caller).

import { supabaseAdmin } from '@/lib/supabase'

export type CommunicationChannel = 'call' | 'sms' | 'email' | 'intake_form'
export type CommunicationDirection = 'inbound' | 'outbound'

export interface LogCommunicationParams {
  practiceId: string
  patientId?: string | null
  patientPhone?: string | null
  patientEmail?: string | null
  channel: CommunicationChannel
  direction: CommunicationDirection
  contentSummary?: string | null
  sentimentScore?: number | null
  durationSeconds?: number | null
  metadata?: Record<string, any>
}

/**
 * Log a communication event to patient_communications.
 * This is fire-and-forget — errors are logged but never thrown.
 */
export async function logCommunication(params: LogCommunicationParams): Promise<void> {
  try {
    const { error } = await supabaseAdmin.from('patient_communications').insert({
      practice_id: params.practiceId,
      patient_id: params.patientId || null,
      patient_phone: params.patientPhone || null,
      patient_email: params.patientEmail || null,
      channel: params.channel,
      direction: params.direction,
      content_summary: params.contentSummary || null,
      sentiment_score: params.sentimentScore || null,
      duration_seconds: params.durationSeconds || null,
      metadata_json: params.metadata || {},
    })
    if (error) {
      console.error(`[Comms] Failed to log ${params.channel}/${params.direction}:`, error.message)
    }
  } catch (err: any) {
    console.error(`[Comms] Unexpected error logging ${params.channel}/${params.direction}:`, err?.message)
  }
}
