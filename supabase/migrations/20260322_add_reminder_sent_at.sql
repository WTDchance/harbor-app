-- Harbor SMS Reminder Tracking Migration
-- Adds reminder tracking columns to the appointments table
-- Run in Supabase SQL Editor: https://supabase.com/dashboard/project/oubmpjtbbobiuzumagec/sql

-- Add reminder tracking columns (idempotent — safe to re-run)
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS patient_phone TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS reminder_opted_out BOOLEAN DEFAULT false;

-- Index for efficient reminder queries: find tomorrow's unsent, non-opted-out appointments
CREATE INDEX IF NOT EXISTS idx_appointments_reminder_due
  ON appointments(appointment_date, reminder_sent_at)
  WHERE reminder_sent_at IS NULL AND reminder_opted_out = false;

-- Index for STOP webhook: look up all upcoming appointments by phone number
CREATE INDEX IF NOT EXISTS idx_appointments_phone
  ON appointments(patient_phone);
