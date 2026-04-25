-- Patient intake tracking: packets + items
-- Run this in the Supabase SQL editor BEFORE deploying the feat/overnight-build PR.
-- Safe to run multiple times (IF NOT EXISTS).

-- =========================================================================
-- intake_packets: one row per patient, per packet issuance
-- =========================================================================
CREATE TABLE IF NOT EXISTS intake_packets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id     uuid NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
  patient_id      uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  call_log_id     uuid REFERENCES call_logs(id) ON DELETE SET NULL,
  status          text NOT NULL DEFAULT 'pending', -- pending | partial | complete | expired
  total_items     integer NOT NULL DEFAULT 0,
  completed_items integer NOT NULL DEFAULT 0,
  last_reminder_at timestamptz,
  reminder_count  integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_intake_packets_practice ON intake_packets(practice_id);
CREATE INDEX IF NOT EXISTS idx_intake_packets_patient  ON intake_packets(patient_id);
CREATE INDEX IF NOT EXISTS idx_intake_packets_status   ON intake_packets(status);

-- =========================================================================
-- intake_packet_items: one row per document in a packet
-- =========================================================================
CREATE TABLE IF NOT EXISTS intake_packet_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  packet_id        uuid NOT NULL REFERENCES intake_packets(id) ON DELETE CASCADE,
  practice_id      uuid NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
  patient_id       uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  document_type    text NOT NULL,        -- e.g. 'intake_form', 'hipaa_notice', 'phq9', 'gad7', 'consent'
  document_title   text NOT NULL,
  token            text,                 -- token for the patient link (FK to intake_tokens if applicable)
  status           text NOT NULL DEFAULT 'pending', -- pending | sent | opened | completed
  sent_at          timestamptz,
  opened_at        timestamptz,
  completed_at     timestamptz,
  reminder_count   integer NOT NULL DEFAULT 0,
  last_reminder_at timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_packet_items_packet   ON intake_packet_items(packet_id);
CREATE INDEX IF NOT EXISTS idx_packet_items_patient  ON intake_packet_items(patient_id);
CREATE INDEX IF NOT EXISTS idx_packet_items_status   ON intake_packet_items(status);

-- =========================================================================
-- Row Level Security
-- =========================================================================
ALTER TABLE intake_packets      ENABLE ROW LEVEL SECURITY;
ALTER TABLE intake_packet_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "intake_packets practice isolation" ON intake_packets;
CREATE POLICY "intake_packets practice isolation" ON intake_packets
  FOR ALL
  USING (practice_id = (SELECT practice_id FROM users WHERE id = auth.uid()))
  WITH CHECK (practice_id = (SELECT practice_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "intake_packet_items practice isolation" ON intake_packet_items;
CREATE POLICY "intake_packet_items practice isolation" ON intake_packet_items
  FOR ALL
  USING (practice_id = (SELECT practice_id FROM users WHERE id = auth.uid()))
  WITH CHECK (practice_id = (SELECT practice_id FROM users WHERE id = auth.uid()));

-- =========================================================================
-- Trigger: recalc packet progress when items change
-- =========================================================================
CREATE OR REPLACE FUNCTION recalc_intake_packet_progress()
RETURNS TRIGGER AS $$
DECLARE
  v_packet_id uuid;
  v_total     int;
  v_done      int;
  v_status    text;
BEGIN
  v_packet_id := COALESCE(NEW.packet_id, OLD.packet_id);
  SELECT count(*), count(*) FILTER (WHERE status = 'completed')
    INTO v_total, v_done
    FROM intake_packet_items
    WHERE packet_id = v_packet_id;

  IF v_done = 0 THEN v_status := 'pending';
  ELSIF v_done < v_total THEN v_status := 'partial';
  ELSE v_status := 'complete';
  END IF;

  UPDATE intake_packets
     SET total_items = v_total,
         completed_items = v_done,
         status = v_status,
         updated_at = now()
   WHERE id = v_packet_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_recalc_intake_packet ON intake_packet_items;
CREATE TRIGGER trg_recalc_intake_packet
  AFTER INSERT OR UPDATE OR DELETE ON intake_packet_items
  FOR EACH ROW EXECUTE FUNCTION recalc_intake_packet_progress();

-- NOTE: Insurance verification (eligibility_checks) is already handled by
-- supabase/migrations/20240001_insurance_verification.sql and the existing
-- /api/insurance/verify route. This migration intentionally does NOT touch
-- that table.
