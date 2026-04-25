#!/usr/bin/env node
/**
 * Seed a realistic intake call transcript on the dev DB so the
 * "Draft from a call" tab has real content to work against.
 *
 * Idempotent: deletes any prior seeded call with the same vapi_call_id
 * before inserting.
 */

import pg from 'pg'
const { Client } = pg
const URL = process.env.SUPABASE_DB_URL
if (!URL || !URL.includes('badelywhoacuccztxhjh')) {
  console.error('Abort: not pointing at dev DB.')
  process.exit(2)
}

const PRACTICE_ID = '00000000-0000-0000-0000-00000000ED01'
const PATIENT_ID  = '00000000-0000-0000-0000-00000000ED10'
const VAPI_CALL_ID = 'seed-call-ehr-dev-001'

const TRANSCRIPT = `Ellie: Thank you for calling Harbor Therapy, this is Ellie. How can I help you?
Caller: Hi. I'm looking to get set up with a therapist. I've been having a really hard time with anxiety lately.
Ellie: I'm glad you reached out. Can you tell me a bit about what's been going on?
Caller: It started a few months ago. My job got really stressful and I've been having panic attacks. My heart races, I feel like I can't breathe. It's happened at work twice this month.
Ellie: That sounds really difficult. Have you talked to anyone about this before?
Caller: I saw someone about five years ago for depression but I haven't been in therapy since. My primary care doctor mentioned medication but I wanted to try talking first.
Ellie: That makes sense. Have you been sleeping okay?
Caller: Not really. I'm waking up at three in the morning and can't fall back asleep. Probably only getting four or five hours a night.
Ellie: Thank you for sharing that. One question I ask everyone — are you having any thoughts of hurting yourself or ending your life?
Caller: No, nothing like that. Just really anxious. And tired.
Ellie: Understood. And how's your appetite, has it changed?
Caller: I've been eating less. Not really hungry most of the time.
Ellie: Any alcohol or substance use that's changed recently?
Caller: I've had a few more glasses of wine than usual in the evenings to unwind. Nothing crazy.
Ellie: Thank you. Let me check Dr. Wonser's availability. We have openings Tuesday afternoon at two p.m. or Thursday morning at ten a.m. for an initial session. Does either work?
Caller: Thursday at ten would be great.
Ellie: Perfect. I'll send you an intake form via text right after this call. Please fill it out before the appointment — it asks about your history and goals. Is there anything else I can help with?
Caller: No, that's it. Thank you so much.
Ellie: You're welcome. Dr. Wonser will see you Thursday at ten.`.replace(/\n/g, '\n')

const SUMMARY = 'New-patient intake call. Caller reports several months of work-related stress, panic attacks (racing heart, shortness of breath) at work twice this month, sleep disturbance (3am wake, ~4-5 hrs), reduced appetite, mild increase in evening alcohol use. History of depression treatment 5 years ago; no current treatment. Denies suicidal ideation or self-harm. Prefers therapy over medication initially. Intake appointment scheduled Thursday 10am with Dr. Wonser; intake form sent via SMS.'

const c = new Client({ connectionString: URL })
await c.connect()

// Remove any prior seed of this exact call (idempotent)
await c.query(`DELETE FROM call_logs WHERE vapi_call_id = $1`, [VAPI_CALL_ID])

await c.query(
  `INSERT INTO call_logs (
     practice_id, patient_id, patient_phone,
     duration_seconds, transcript, summary, vapi_call_id,
     call_type, session_type, caller_name, reason_for_calling,
     is_new_patient, booking_attempted, booking_succeeded,
     crisis_detected, created_at
   )
   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, NOW() - INTERVAL '2 days')`,
  [
    PRACTICE_ID, PATIENT_ID, '+15550000010',
    362, TRANSCRIPT, SUMMARY, VAPI_CALL_ID,
    'inbound', 'intake', 'Sample Patient',
    'anxiety, panic attacks, sleep disturbance',
    true, true, true,
    false,
  ],
)

console.log('Seeded test intake call for Sample Patient (duration ~6 min, intake type).')
console.log('Try it at: Patient profile -> AI Draft -> "From a call" tab.')

await c.end()
