// Drizzle definitions matching the ACTUAL RDS schema (infra/sql/schema.sql).

import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  date,
  index,
  smallint,
} from 'drizzle-orm/pg-core'

export const practices = pgTable('practices', {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  slug: text().unique(),
  ownerEmail: text().notNull(),
  phone: text(),
  timezone: text().notNull().default('America/Los_Angeles'),
  provisioningState: text().notNull().default('pending_payment'),
  foundingMember: boolean().notNull().default(false),
  stripeCustomerId: text(),
  stripeSubscriptionId: text(),
  stripePriceId: text(),
  plan: text(),
  vapiAssistantId: text(),
  vapiPhoneNumberId: text(),
  voiceProvider: text().notNull().default('twilio'),
  twilioPhoneNumber: text(),
  twilioPhoneSid: text(),
  signalwireNumber: text(),
  greeting: text(),
  ehrEnabled: boolean().notNull().default(false),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
})

export const users = pgTable('users', {
  id: uuid().primaryKey().defaultRandom(),
  cognitoSub: text().notNull().unique(),
  email: text().notNull(),
  fullName: text(),
  practiceId: uuid().references(() => practices.id, { onDelete: 'set null' }),
  role: text().notNull().default('clinician'),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
})

export const therapists = pgTable('therapists', {
  id: uuid().primaryKey().defaultRandom(),
  practiceId: uuid().notNull().references(() => practices.id, { onDelete: 'cascade' }),
  displayName: text().notNull(),
  credentials: text(),
  bio: text(),
  isPrimary: boolean().notNull().default(false),
  isActive: boolean().notNull().default(true),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
})

export const patients = pgTable('patients', {
  id: uuid().primaryKey().defaultRandom(),
  practiceId: uuid().notNull().references(() => practices.id, { onDelete: 'cascade' }),
  // Identity
  firstName: text(),
  lastName: text(),
  preferredName: text(),
  dateOfBirth: date(),
  phone: text(),
  email: text(),
  // Demographics (subset)
  city: text(),
  state: text(),
  // Insurance
  insuranceProvider: text(),
  insuranceMemberId: text(),
  insuranceVerifiedAt: timestamp({ withTimezone: true }),
  // Status
  patientStatus: text().notNull().default('inquiry'),
  riskLevel: text(),
  firstContactAt: timestamp({ withTimezone: true }),
  lastContactAt: timestamp({ withTimezone: true }),
  // Audit
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
})

export const callLogs = pgTable('call_logs', {
  id: uuid().primaryKey().defaultRandom(),
  practiceId: uuid().notNull().references(() => practices.id, { onDelete: 'cascade' }),
  patientId: uuid().references(() => patients.id, { onDelete: 'set null' }),
  // Provider IDs
  vapiCallId: text(),
  twilioCallSid: text(),
  // Parties
  direction: text().notNull().default('inbound'),
  fromNumber: text(),
  toNumber: text(),
  // Timing
  startedAt: timestamp({ withTimezone: true }).notNull(),
  endedAt: timestamp({ withTimezone: true }),
  durationSeconds: integer(),
  // Outcome
  callType: text(),
  endedReason: text(),
  bookingOutcome: text(),
  appointmentId: uuid(),
  // Content
  transcript: jsonb(),
  summary: text(),
  structuredSummary: jsonb(),
  sentiment: text(),
  // Crisis
  crisisDetected: boolean().notNull().default(false),
  crisisTier: smallint(),
  // Audit
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
})

export const appointments = pgTable('appointments', {
  id: uuid().primaryKey().defaultRandom(),
  practiceId: uuid().notNull().references(() => practices.id, { onDelete: 'cascade' }),
  patientId: uuid().notNull().references(() => patients.id, { onDelete: 'cascade' }),
  callLogId: uuid().references(() => callLogs.id, { onDelete: 'set null' }),
  // Scheduling
  scheduledFor: timestamp({ withTimezone: true }).notNull(),
  durationMinutes: integer().notNull().default(50),
  appointmentType: text().notNull().default('initial_consult'),
  // Status
  status: text().notNull().default('scheduled'),
  bookedVia: text(),
  // Calendar sync
  calendarEventId: text(),
  calendarSyncStatus: text().default('pending'),
  // Reminders
  reminderSentAt: timestamp({ withTimezone: true }),
  confirmationSentAt: timestamp({ withTimezone: true }),
  notes: text(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp({ withTimezone: true }),
})

export const intakeForms = pgTable('intake_forms', {
  id: uuid().primaryKey().defaultRandom(),
  practiceId: uuid().notNull().references(() => practices.id, { onDelete: 'cascade' }),
  patientId: uuid().notNull().references(() => patients.id, { onDelete: 'cascade' }),
  callLogId: uuid().references(() => callLogs.id, { onDelete: 'set null' }),
  formType: text().notNull(),
  status: text().notNull().default('sent'),
  sentAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  openedAt: timestamp({ withTimezone: true }),
  completedAt: timestamp({ withTimezone: true }),
  expiresAt: timestamp({ withTimezone: true }),
  answers: jsonb(),
  score: integer(),
  severity: text(),
  linkToken: text().unique(),
  deliveryChannel: text().default('sms'),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
})

export const calendarConnections = pgTable('calendar_connections', {
  id: uuid().primaryKey().defaultRandom(),
  practiceId: uuid().notNull().references(() => practices.id, { onDelete: 'cascade' }),
  provider: text().notNull().default('google'),
  accessToken: text(),
  refreshToken: text(),
  expiresAt: timestamp({ withTimezone: true }),
  calendarId: text(),
  email: text(),
  status: text().default('active'),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
})

export const crisisAlerts = pgTable('crisis_alerts', {
  id: uuid().primaryKey().defaultRandom(),
  practiceId: uuid().notNull().references(() => practices.id, { onDelete: 'cascade' }),
  callLogId: uuid().references(() => callLogs.id, { onDelete: 'set null' }),
  tier: smallint().notNull(),
  phrase: text(),
  transcriptSnippet: text(),
  alertedAt: timestamp({ withTimezone: true }),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
})
