// Core (non-EHR) tables: practices, users, patients, appointments, call_logs,
// intake_forms, calendar_connections, crisis_alerts, therapists.

import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  date,
  bigserial,
  unique,
  index,
} from 'drizzle-orm/pg-core'

export const practices = pgTable('practices', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').unique(),
  ownerEmail: text('owner_email').notNull(),
  phone: text('phone'),
  timezone: text('timezone').notNull().default('America/Los_Angeles'),
  provisioningState: text('provisioning_state').notNull().default('pending_payment'),
  foundingMember: boolean('founding_member').notNull().default(false),
  stripeCustomerId: text('stripe_customer_id'),
  stripeSubscriptionId: text('stripe_subscription_id'),
  stripePriceId: text('stripe_price_id'),
  plan: text('plan'),
  vapiAssistantId: text('vapi_assistant_id'),
  vapiPhoneNumberId: text('vapi_phone_number_id'),
  voiceProvider: text('voice_provider').notNull().default('twilio'),
  twilioPhoneNumber: text('twilio_phone_number'),
  twilioPhoneSid: text('twilio_phone_sid'),
  signalwireNumber: text('signalwire_number'),
  // Crisis routing
  crisisPhoneNumber: text('crisis_phone_number'),
  // Calendar
  googleCalendarId: text('google_calendar_id'),
  // Identity / branding
  greeting: text('greeting'),
  specialties: jsonb('specialties'),
  hours: jsonb('hours'),
  // Audit
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  cognitoSub: text('cognito_sub').notNull().unique(),
  email: text('email').notNull(),
  fullName: text('full_name'),
  practiceId: uuid('practice_id').references(() => practices.id, { onDelete: 'set null' }),
  role: text('role').notNull().default('clinician'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const therapists = pgTable('therapists', {
  id: uuid('id').primaryKey().defaultRandom(),
  practiceId: uuid('practice_id').notNull().references(() => practices.id, { onDelete: 'cascade' }),
  displayName: text('display_name').notNull(),
  credentials: text('credentials'),
  bio: text('bio'),
  isPrimary: boolean('is_primary').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  byPracticeActive: index('idx_therapists_practice_active').on(t.practiceId, t.isActive),
}))

export const patients = pgTable('patients', {
  id: uuid('id').primaryKey().defaultRandom(),
  practiceId: uuid('practice_id').notNull().references(() => practices.id, { onDelete: 'cascade' }),
  firstName: text('first_name'),
  lastName: text('last_name'),
  fullName: text('full_name'),
  email: text('email'),
  phoneNumber: text('phone_number'),
  dateOfBirth: date('date_of_birth'),
  // Status
  status: text('status').default('new'),
  // Insurance
  insuranceCarrier: text('insurance_carrier'),
  insuranceMemberId: text('insurance_member_id'),
  insuranceVerified: boolean('insurance_verified'),
  // Source
  acquisitionSource: text('acquisition_source'),
  firstCallId: uuid('first_call_id'),
  // Audit
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const callLogs = pgTable('call_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  practiceId: uuid('practice_id').notNull().references(() => practices.id, { onDelete: 'cascade' }),
  patientId: uuid('patient_id').references(() => patients.id, { onDelete: 'set null' }),
  vapiCallId: text('vapi_call_id'),
  callerPhone: text('caller_phone'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  durationSeconds: integer('duration_seconds'),
  transcript: text('transcript'),
  summary: text('summary'),
  sentiment: text('sentiment'),
  callType: text('call_type'),
  bookedAppointment: boolean('booked_appointment').default(false),
  appointmentId: uuid('appointment_id'),
  // Crisis
  crisisFlagged: boolean('crisis_flagged').default(false),
  crisisLevel: text('crisis_level'),
  // Audit
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  byPracticeStarted: index('idx_calls_practice_started').on(t.practiceId, t.startedAt),
}))

export const appointments = pgTable('appointments', {
  id: uuid('id').primaryKey().defaultRandom(),
  practiceId: uuid('practice_id').notNull().references(() => practices.id, { onDelete: 'cascade' }),
  patientId: uuid('patient_id').references(() => patients.id, { onDelete: 'set null' }),
  therapistId: uuid('therapist_id').references(() => therapists.id, { onDelete: 'set null' }),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
  status: text('status').notNull().default('booked'),
  visitType: text('visit_type'),
  notes: text('notes'),
  calendarEventId: text('calendar_event_id'),
  vapiCallId: text('vapi_call_id'),
  reminderSentAt: timestamp('reminder_sent_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  byPracticeStart: index('idx_appts_practice_start').on(t.practiceId, t.startsAt),
}))

export const intakeForms = pgTable('intake_forms', {
  id: uuid('id').primaryKey().defaultRandom(),
  practiceId: uuid('practice_id').notNull().references(() => practices.id, { onDelete: 'cascade' }),
  patientId: uuid('patient_id').references(() => patients.id, { onDelete: 'set null' }),
  callId: uuid('call_id').references(() => callLogs.id, { onDelete: 'set null' }),
  status: text('status').notNull().default('sent'),
  formType: text('form_type'),
  responses: jsonb('responses'),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const calendarConnections = pgTable('calendar_connections', {
  id: uuid('id').primaryKey().defaultRandom(),
  practiceId: uuid('practice_id').notNull().references(() => practices.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull().default('google'),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  calendarId: text('calendar_id'),
  email: text('email'),
  status: text('status').default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const crisisAlerts = pgTable('crisis_alerts', {
  id: uuid('id').primaryKey().defaultRandom(),
  practiceId: uuid('practice_id').notNull().references(() => practices.id, { onDelete: 'cascade' }),
  callId: uuid('call_id').references(() => callLogs.id, { onDelete: 'set null' }),
  tier: integer('tier').notNull(),
  phrase: text('phrase'),
  transcriptSnippet: text('transcript_snippet'),
  alertedAt: timestamp('alerted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
