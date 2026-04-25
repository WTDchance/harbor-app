-- TheraLink Sample Data
-- Run this after schema.sql to populate with demo data

-- ============================================================================
-- INSERT SAMPLE PRACTICE
-- Dr. Trace's Hope and Harmony Counseling in Eugene, Oregon
-- ============================================================================
INSERT INTO practices (
  id,
  name,
  ai_name,
  phone_number,
  hours_json,
  insurance_accepted,
  timezone
) VALUES (
  '550e8400-e29b-41d4-a716-446655440001'::UUID,
  'Hope and Harmony Counseling',
  'Ellie',
  '+15551234567',
  '{
    "monday": {"enabled": true, "openTime": "08:00", "closeTime": "18:00"},
    "tuesday": {"enabled": true, "openTime": "08:00", "closeTime": "18:00"},
    "wednesday": {"enabled": true, "openTime": "10:00", "closeTime": "20:00"},
    "thursday": {"enabled": true, "openTime": "08:00", "closeTime": "18:00"},
    "friday": {"enabled": true, "openTime": "08:00", "closeTime": "17:00"},
    "saturday": {"enabled": true, "openTime": "09:00", "closeTime": "13:00"},
    "sunday": {"enabled": false}
  }'::JSONB,
  ARRAY['Aetna', 'BlueCross', 'Cigna', 'United Healthcare', 'OHP (Oregon Health Plan)'],
  'America/Los_Angeles'
);

-- ============================================================================
-- INSERT ADMIN USER
-- Dr. Trace (the practice owner)
-- ============================================================================
INSERT INTO users (
  practice_id,
  email,
  role
) VALUES (
  '550e8400-e29b-41d4-a716-446655440001'::UUID,
  'dr.trace@hopeandharmony.local',
  'admin'
);

-- ============================================================================
-- INSERT SAMPLE PATIENTS
-- ============================================================================
INSERT INTO patients (
  practice_id,
  first_name,
  last_name,
  phone,
  email,
  insurance,
  reason_for_seeking
) VALUES
(
  '550e8400-e29b-41d4-a716-446655440001'::UUID,
  'Jessica',
  'Chen',
  '+15551112222',
  'jessica.chen@email.com',
  'Aetna',
  'Anxiety and work stress management'
),
(
  '550e8400-e29b-41d4-a716-446655440001'::UUID,
  'Marcus',
  'Johnson',
  '+15551113333',
  'marcus.j@email.com',
  'BlueCross',
  'Depression and life transitions'
),
(
  '550e8400-e29b-41d4-a716-446655440001'::UUID,
  'Sarah',
  'Williams',
  '+15551114444',
  'sarah.w@email.com',
  'Cigna',
  'Couples counseling'
),
(
  '550e8400-e29b-41d4-a716-446655440001'::UUID,
  'David',
  'Martinez',
  '+15551115555',
  'david.m@email.com',
  'United Healthcare',
  'Trauma-informed therapy'
);

-- ============================================================================
-- INSERT SAMPLE APPOINTMENTS
-- Upcoming appointments this week
-- ============================================================================
INSERT INTO appointments (
  practice_id,
  patient_id,
  scheduled_at,
  duration_minutes,
  status,
  notes
) VALUES
(
  '550e8400-e29b-41d4-a716-446655440001'::UUID,
  (SELECT id FROM patients WHERE first_name = 'Jessica' AND last_name = 'Chen'),
  NOW() + INTERVAL '1 day' AT TIME ZONE 'America/Los_Angeles' + INTERVAL '14:00 hours',
  60,
  'scheduled',
  'Follow-up: Work anxiety techniques'
),
(
  '550e8400-e29b-41d4-a716-446655440001'::UUID,
  (SELECT id FROM patients WHERE first_name = 'Marcus' AND last_name = 'Johnson'),
  NOW() + INTERVAL '2 days' AT TIME ZONE 'America/Los_Angeles' + INTERVAL '10:00 hours',
  50,
  'scheduled',
  'Initial intake session'
),
(
  '550e8400-e29b-41d4-a716-446655440001'::UUID,
  (SELECT id FROM patients WHERE first_name = 'Sarah' AND last_name = 'Williams'),
  NOW() + INTERVAL '3 days' AT TIME ZONE 'America/Los_Angeles' + INTERVAL '16:00 hours',
  90,
  'scheduled',
  'Couples session: Communication patterns'
);

-- ============================================================================
-- INSERT SAMPLE CALL LOG
-- Demo call from 2 days ago
-- ============================================================================
INSERT INTO call_logs (
  practice_id,
  patient_phone,
  duration_seconds,
  transcript,
  summary,
  vapi_call_id
) VALUES (
  '550e8400-e29b-41d4-a716-446655440001'::UUID,
  '+15551119999',
  447,
  'Ellie: Good afternoon, this is Ellie with Hope and Harmony Counseling. How can I help you today?
Caller: Hi, I''m looking to schedule an appointment with someone who specializes in anxiety.
Ellie: Of course! I''d be happy to help. First, may I have your name?
Caller: It''s Alex Turner.
Ellie: Great, Alex. And what is the best phone number to reach you at?
Caller: 555-1119999
Ellie: Perfect. When was the last time you had therapy or counseling?
Caller: It''s been about 3 years.
Ellie: Thank you for sharing that. We have some great options for anxiety treatment. Would you prefer morning or afternoon appointments?
Caller: Afternoon would work better for me.
Ellie: Excellent. I have some availability next week. Does Thursday at 2 PM work for you?
Caller: Thursday at 2 PM is perfect.
Ellie: Wonderful! I''ve scheduled you for Thursday, March 27th at 2:00 PM. Is there anything else I can help you with today?
Caller: No, that''s all. Thank you!
Ellie: You''re very welcome, Alex. We look forward to seeing you Thursday. Goodbye!',
  'New patient intake: Alex Turner, anxiety concerns, scheduled for Thursday 2 PM',
  'call_demo_2024_01_001'
);

-- ============================================================================
-- INSERT SAMPLE SMS CONVERSATION
-- Recent scheduling text with a patient
-- ============================================================================
INSERT INTO sms_conversations (
  practice_id,
  patient_phone,
  messages_json,
  last_message_at
) VALUES (
  '550e8400-e29b-41d4-a716-446655440001'::UUID,
  '+15551112222',
  '[
    {
      "direction": "outbound",
      "content": "Hi Jessica! This is Ellie from Hope and Harmony. Just confirming your appointment tomorrow at 2 PM. Reply YES to confirm or call us at 555-1234567.",
      "timestamp": "2024-03-20T09:30:00Z"
    },
    {
      "direction": "inbound",
      "content": "YES, confirmed! See you tomorrow",
      "timestamp": "2024-03-20T11:45:00Z"
    },
    {
      "direction": "outbound",
      "content": "Perfect! We''ll see you tomorrow at 2 PM. Thank you for choosing Hope and Harmony.",
      "timestamp": "2024-03-20T11:46:00Z"
    }
  ]'::JSONB,
  NOW() - INTERVAL '2 hours'
);

-- ============================================================================
-- VERIFY DATA
-- ============================================================================
-- Run these queries to verify:
-- SELECT COUNT(*) FROM practices;  -- Should show 1
-- SELECT COUNT(*) FROM patients;   -- Should show 4
-- SELECT COUNT(*) FROM appointments; -- Should show 3
-- SELECT COUNT(*) FROM call_logs;  -- Should show 1
-- SELECT COUNT(*) FROM sms_conversations; -- Should show 1
