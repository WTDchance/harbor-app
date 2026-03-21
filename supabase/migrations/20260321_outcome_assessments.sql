CREATE TABLE IF NOT EXISTS outcome_assessments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    practice_id UUID REFERENCES practices(id) ON DELETE CASCADE,
    patient_name TEXT NOT NULL,
    patient_phone TEXT,
    assessment_type TEXT NOT NULL,
    token TEXT UNIQUE NOT NULL,
    status TEXT DEFAULT 'pending',
    score INTEGER,
    severity TEXT,
    responses JSONB,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );

CREATE INDEX IF NOT EXISTS outcome_assessments_practice_id_idx ON outcome_assessments(practice_id);
CREATE INDEX IF NOT EXISTS outcome_assessments_patient_phone_idx ON outcome_assessments(patient_phone);
