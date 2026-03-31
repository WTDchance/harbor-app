-- 20260330: Expand intake_forms for demographics, insurance, signatures, and document management
-- This migration adds columns needed for the full intake packet feature

-- Add new JSONB columns to intake_forms for demographics and insurance
ALTER TABLE intake_forms ADD COLUMN IF NOT EXISTS demographics JSONB;
ALTER TABLE intake_forms ADD COLUMN IF NOT EXISTS insurance JSONB;
ALTER TABLE intake_forms ADD COLUMN IF NOT EXISTS signature_data TEXT;  -- base64 PNG of patient signature
ALTER TABLE intake_forms ADD COLUMN IF NOT EXISTS signed_name TEXT;     -- typed legal name

-- Expand intake_documents table for practice-uploaded documents
ALTER TABLE intake_documents ADD COLUMN IF NOT EXISTS content_url TEXT;     -- URL to PDF/document in storage
ALTER TABLE intake_documents ADD COLUMN IF NOT EXISTS description TEXT;     -- Brief description shown to patient
ALTER TABLE intake_documents ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT true;
ALTER TABLE intake_documents ADD COLUMN IF NOT EXISTS sort_order INT DEFAULT 0;
ALTER TABLE intake_documents ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE intake_documents ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- Add signature_image to intake_document_signatures for per-document e-signatures
ALTER TABLE intake_document_signatures ADD COLUMN IF NOT EXISTS signature_image TEXT;  -- base64 PNG
