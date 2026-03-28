// Type definitions for Harbor

export interface Practice {
  id: string
  name: string
  ai_name: string
  phone_number: string
  hours_json: BusinessHours
  insurance_accepted: string[]
  timezone: string
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  created_at: string
  updated_at: string
}

export interface BusinessHours {
  [key: string]: {
    enabled: boolean
    openTime?: string
    closeTime?: string
  }
}

export interface User {
  id: string
  practice_id: string
  email: string
  role: 'admin' | 'staff'
  created_at: string
}

export interface Patient {
  id: string
  practice_id: string
  first_name: string
  last_name: string
  phone: string
  email: string | null
  insurance: string | null
  reason_for_seeking: string | null
  preferred_session_type: 'telehealth' | 'in-person' | null
  notes: string | null
  created_at: string
}

export interface Appointment {
  id: string
  practice_id: string
  patient_id: string
  scheduled_at: string
  duration_minutes: number
  status: 'scheduled' | 'completed' | 'cancelled' | 'no-show'
  notes: string | null
  created_at: string
}

export interface CallLog {
  id: string
  practice_id: string
  patient_phone: string
  duration_seconds: number
  transcript: string | null
  summary: string | null
  vapi_call_id: string | null
  crisis_detected: boolean
  patient_id: string | null
  call_type: 'new_patient' | 'existing_patient' | 'scheduling' | 'cancellation' | 'question' | 'crisis' | 'other' | 'unknown'
  caller_name: string | null
  insurance_mentioned: string | null
  session_type: 'telehealth' | 'in-person' | null
  preferred_times: string | null
  reason_for_calling: string | null
  created_at: string
}

export interface SMSConversation {
  id: string
  practice_id: string
  patient_phone: string
  messages_json: SMSMessage[]
  last_message_at: string
  created_at: string
}

export interface SMSMessage {
  direction: 'inbound' | 'outbound'
  content: string
  timestamp: string
  message_sid?: string
}

// API Request/Response types
export interface VapiWebhookPayload {
  type: 'call-started' | 'transcript' | 'call-ended' | 'function-call'
  callId: string
  call?: {
    startedAt: string
    endedAt?: string
    durationSeconds?: number
    messages?: Array<{
      role: 'user' | 'assistant'
      content: string
    }>
  }
  transcript?: string
  functionCall?: {
    name: string
    args: Record<string, any>
  }
}

export interface TwilioInboundSMSPayload {
  From: string
  To: string
  Body: string
  MessageSid: string
  NumMedia: string
}

export interface TwilioSendSMSRequest {
  to: string
  body: string
  practiceId: string
}

export interface ClaudeMessageRequest {
  messages: Array<{
    role: 'user' | 'assistant'
    content: string
  }>
  system: string
}

// Dashboard stats
export interface DashboardStats {
  callsToday: number
  messagesToday: number
  appointmentsToday: number
  newPatientsThisWeek: number
}

export interface RecentCall {
  id: string
  patient_phone: string
  duration_seconds: number
  summary: string | null
  created_at: string
}

export interface UpcomingAppointment {
  id: string
  patient: Patient
  scheduled_at: string
  duration_minutes: number
  notes: string | null
}

