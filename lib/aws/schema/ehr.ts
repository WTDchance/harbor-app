// EHR-specific tables. Mirrors the 18 ehr_* migrations applied to RDS.
// Only the columns the dashboard ports actively use are defined here — add
// more as needed; nothing breaks if a column exists in the DB but not the
// schema (Drizzle is opt-in for select).

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
  numeric,
} from 'drizzle-orm/pg-core'
import { practices, patients, therapists, appointments, callLogs } from './core'

export const ehrProgressNotes = pgTable('ehr_progress_notes', {
  id: uuid('id').primaryKey().defaultRandom(),
  practiceId: uuid('practice_id').notNull().references(() => practices.id, { onDelete: 'cascade' }),
  patientId: uuid('patient_id').notNull().references(() => patients.id, { onDelete: 'cascade' }),
  therapistId: uuid('therapist_id').references(() => therapists.id, { onDelete: 'set null' }),
  appointmentId: uuid('appointment_id').references(() => appointments.id, { onDelete: 'set null' }),
  callId: uuid('call_id').references(() => callLogs.id, { onDelete: 'set null' }),
  amendmentOf: uuid('amendment_of'),
  // Note format
  format: text('format').notNull().default('soap'),
  status: text('status').notNull().default('draft'),
  // SOAP fields (or generic content)
  subjective: text('subjective'),
  objective: text('objective'),
  assessment: text('assessment'),
  planText: text('plan'),
  // For non-SOAP formats / collapsed content
  content: text('content'),
  // CPT / ICD codes
  cptCode: text('cpt_code'),
  icdCodes: jsonb('icd_codes'),
  // Sign
  signedAt: timestamp('signed_at', { withTimezone: true }),
  signedBy: uuid('signed_by'),
  // Audit
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  byPatient: index('idx_progress_notes_patient').on(t.patientId, t.createdAt),
}))

export const ehrTreatmentPlans = pgTable('ehr_treatment_plans', {
  id: uuid('id').primaryKey().defaultRandom(),
  practiceId: uuid('practice_id').notNull().references(() => practices.id, { onDelete: 'cascade' }),
  patientId: uuid('patient_id').notNull().references(() => patients.id, { onDelete: 'cascade' }),
  therapistId: uuid('therapist_id').references(() => therapists.id, { onDelete: 'set null' }),
  status: text('status').notNull().default('active'),
  diagnoses: jsonb('diagnoses'),
  goals: jsonb('goals'),
  modalities: jsonb('modalities'),
  reviewDate: date('review_date'),
  signedAt: timestamp('signed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const ehrSafetyPlans = pgTable('ehr_safety_plans', {
  id: uuid('id').primaryKey().defaultRandom(),
  practiceId: uuid('practice_id').notNull().references(() => practices.id, { onDelete: 'cascade' }),
  patientId: uuid('patient_id').notNull().references(() => patients.id, { onDelete: 'cascade' }),
  therapistId: uuid('therapist_id').references(() => therapists.id, { onDelete: 'set null' }),
  warningSigns: jsonb('warning_signs'),
  copingStrategies: jsonb('coping_strategies'),
  socialContacts: jsonb('social_contacts'),
  professionals: jsonb('professionals'),
  meansRestriction: text('means_restriction'),
  signedAt: timestamp('signed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const ehrCharges = pgTable('ehr_charges', {
  id: uuid('id').primaryKey().defaultRandom(),
  practiceId: uuid('practice_id').notNull().references(() => practices.id, { onDelete: 'cascade' }),
  patientId: uuid('patient_id').notNull().references(() => patients.id, { onDelete: 'cascade' }),
  appointmentId: uuid('appointment_id').references(() => appointments.id, { onDelete: 'set null' }),
  noteId: uuid('note_id').references(() => ehrProgressNotes.id, { onDelete: 'set null' }),
  cptCode: text('cpt_code').notNull(),
  description: text('description'),
  units: integer('units').notNull().default(1),
  unitAmountCents: integer('unit_amount_cents').notNull(),
  totalAmountCents: integer('total_amount_cents').notNull(),
  status: text('status').notNull().default('unbilled'),
  serviceDate: date('service_date'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const ehrInvoices = pgTable('ehr_invoices', {
  id: uuid('id').primaryKey().defaultRandom(),
  practiceId: uuid('practice_id').notNull().references(() => practices.id, { onDelete: 'cascade' }),
  patientId: uuid('patient_id').notNull().references(() => patients.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('draft'),
  totalCents: integer('total_cents').notNull(),
  paidCents: integer('paid_cents').notNull().default(0),
  dueDate: date('due_date'),
  stripeInvoiceId: text('stripe_invoice_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const ehrPayments = pgTable('ehr_payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  practiceId: uuid('practice_id').notNull().references(() => practices.id, { onDelete: 'cascade' }),
  invoiceId: uuid('invoice_id').references(() => ehrInvoices.id, { onDelete: 'set null' }),
  patientId: uuid('patient_id').references(() => patients.id, { onDelete: 'set null' }),
  amountCents: integer('amount_cents').notNull(),
  method: text('method'),
  stripePaymentIntentId: text('stripe_payment_intent_id'),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
