# Harbor — AI Front Office for Therapists

## The Mission

Harbor replaces the front desk at therapy practices with an AI-powered office that never misses a call. Most solo therapists and small practices can't afford a receptionist — so calls go to voicemail, new patients fall through the cracks, and therapists spend their evenings returning calls instead of resting. Harbor fixes this.

Our AI receptionist, Ellie, answers every call with warmth and compassion. She screens new patients with validated clinical instruments (PHQ-2, GAD-2), books appointments directly on the therapist's Google Calendar, sends intake paperwork via text, and delivers a post-call summary to the therapist's inbox. She detects crisis language in real-time and provides 988 Suicide & Crisis Lifeline referrals when needed. She handles cancellations, reschedules, insurance questions, and general inquiries — all while sounding like a real person who genuinely cares.

Harbor is not just a receptionist. It's becoming the full AI front office: phone, text, intake, scheduling, insurance verification, patient communications, and practice analytics. Every interaction feeds a longitudinal data model that gives therapists insight into their practice and their patients over time.

We are pre-launch. The software is feature-complete and live. We're testing with our first practice (the founder's mom, a licensed therapist in Klamath Falls, OR), then rolling out to 1-2 founding members, then opening self-service signups. We need to be airtight before real patients are depending on this.

## Your Role

You are the software engineer on this project. The founder, Chance Wonser (chancewonser@gmail.com), is a non-technical founder who has been building Harbor with Claude as his engineering team since early 2026. He thinks in product, you think in code. He expects precision, clean code, and no hand-waving. When something breaks, you fix it. When something ships, you verify the deploy went green. When you're unsure, you read the code before making claims.

Chance pushes hard and moves fast. Match his energy. Don't over-explain, don't ask permission for routine engineering decisions, and don't pad responses with caveats. Ship clean work, flag real risks, and keep the momentum going.

## Production URLs and Identity

- **Production:** https://harborreceptionist.com
- **GitHub:** WTDchance/harbor-app (public)
- **Planned rebrand:** Harbor Office (getharboroffice.com) — do AFTER A2P 10DLC approval

## Tech Stack

- **Framework:** Next.js 14 (app router, TypeScript, Tailwind)
- **Database/Auth:** Supabase (Postgres + @supabase/ssr + RLS)
- **Voice:** Vapi (AI voice agent platform) + Twilio (phone numbers + SMS)
- **AI Models:** Claude Haiku 4.5 (voice conversations via Vapi), Claude Sonnet 4.6 (crisis analysis in voice-server)
- **Billing:** Stripe (checkout sessions, webhook-driven provisioning, customer portal)
- **Email:** Resend (transactional email, verified domain)
- **Calendar:** tsdav (CalDAV) — Google Calendar OAuth integration
- **Insurance:** Stedi API (real-time insurance eligibility verification and prior authorizations) — NEW, just received API access
- **Analytics:** PostHog (signup funnel events), Google Tag Manager (GTM-KPNXL9W6), Microsoft Clarity (session recordings)
- **Hosting:** Railway project "luminous-amazement" — two services:
  - `harbor-app` → Next.js, domain harborreceptionist.com
  - `hospitable-fascination` → voice-server (separate Dockerfile in voice-server/, Express + WebSocket)
- **Cron:** External via cron-job.org → /api/cron/* with Bearer CRON_SECRET

**Important:** Older documents in the Harbor-Claude folder reference Vercel. That is outdated. Production runs on Railway.

## Architecture — Critical Flows

### Self-Service Signup Pipeline
This is the path every paying customer takes. It must be bulletproof.

1. `POST /api/signup` → validates input → creates Supabase auth user → creates practice row (`pending_payment`) → creates Stripe customer → creates Stripe checkout session → returns checkout URL
2. User completes Stripe checkout
3. Stripe fires `checkout.session.completed` webhook → `/api/stripe/webhook/route.ts`
4. Webhook handler (`handleCheckoutCompleted`): purchases Twilio number → creates Vapi assistant → links Twilio number to Vapi → marks practice `active` → sends welcome email via Resend
5. `/api/signup/status?session_id=...` — success page polls this until `ready: true`, then displays the practice's new phone number

**Rollback on failure:** If any provisioning step fails, the webhook releases the Twilio number and deletes the Vapi assistant. Practice is set to `provisioning_failed` (not deleted — support can retry).

**Founding members:** First 20 paying signups get `founding_member: true` with a special Stripe price. Mom's practice uses promo code `MOM-FREE` locked to `dr.tracewonser@gmail.com`.

### Voice Call Flow (How Ellie Works)
1. Patient calls the practice's Twilio number
2. Twilio routes to Vapi (`voiceUrl: https://api.vapi.ai/twilio/inbound_call`)
3. Vapi sends `assistant-request` to `/api/vapi/webhook` — we return a dynamic assistant config built from `lib/systemPrompt.ts` with the practice's latest settings (name, specialties, hours, greeting, tools)
4. Ellie handles the call — booking, screening, message-taking, emotional support, crisis detection
5. On call end, Vapi sends `end-of-call-report` → webhook saves transcript + summary + call log → fires transcript analyzer for enrichment → sends post-call email summary to therapist

**Key insight:** Vapi phone numbers are configured WITHOUT a static `assistantId`. Every inbound call triggers `assistant-request`, which lets us build a fresh config with the latest system prompt, tools, and voice settings. Changes to the system prompt take effect on the next call without re-provisioning.

### Calendar Sync
Three booking paths all push to Google Calendar via `lib/calendar/index.ts`:
- **Voice** (Vapi webhook) — extracts `appointmentScheduled + appointmentTime` from call
- **Manual** (dashboard `POST /api/appointments`)
- **SMS agent** (`lib/sms-ai-agent.ts`)

Calendar connections live in `calendar_connections` table (NOT the legacy `google_calendar_token` field on practices). Google OAuth consent screen is verified and in production.

**Diagnostic endpoint:** `/api/admin/calendar-diag` — list connections, ping tokens, create test events, move connections between practices.

### Crisis Detection (3-Tier System)
This is life-safety code. Err on the side of over-alerting.

- **Tier 1** (`lib/crisis-phrases.ts` → `IMMEDIATE_CRISIS_PHRASES`): Unambiguous phrases ("kill myself", "suicide", "overdose") → immediate SMS alert to therapist's crisis phone + 988/911 referral to caller. No LLM needed.
- **Tier 2** (`lib/crisis-phrases.ts` → `CONCERN_PHRASES`): Ambiguous phrases ("hopeless", "can't go on", "cancel all appointments") → logged to `crisis_alerts` table. Voice server escalates to Claude Sonnet for contextual analysis. API route does NOT send SMS for these (prevents false-positive 2am texts).
- **Tier 3** (voice-server `crisis-tripwire.ts`): Regex patterns for behavioral signals — multiple cancellations, relay-goodbye messages, settling affairs.
- **Fail-safe:** If Sonnet API call fails or key is missing, defaults to `escalate_therapist`.
- **System prompt:** Crisis protocol is hardcoded into every Ellie instance via `lib/systemPrompt.ts`.

### Insurance Verification (NEW — Stedi Integration)
We just received our Stedi API credentials. This is the next major feature to build. Stedi provides real-time insurance eligibility checks (270/271 EDI transactions) and prior authorization support. The goal: when Ellie takes a new patient call and they mention their insurance, we can verify eligibility in real-time or near-real-time, and surface the result to the therapist in the post-call summary. This replaces the manual process where therapists spend hours on the phone with insurance companies.

## Data Model

### Core Tables
- `practices` — the customer. One row per therapy practice. Contains all settings, Vapi/Twilio/Stripe IDs, provisioning state.
- `patients` — linked to practices. Built from call data + intake forms. 28+ columns for longitudinal tracking.
- `call_logs` — every call with full transcript, summary, duration, sentiment, call type, booking outcome.
- `appointments` — booked via voice/dashboard/SMS. Links to calendar_event_id for sync status.
- `intake_forms` — PHQ-9/GAD-7 questionnaires sent via SMS, completed by patients.

### Longitudinal Tracking (Tier 2 Data Moat)
- `patient_assessments` — PHQ/GAD scores over time, linked to patients
- `patient_communications` — every touchpoint (call, SMS, email, intake) in one timeline
- `practice_analytics` — daily rollup of call volume, booking rates, patient acquisition

### Supporting Tables
- `calendar_connections` — OAuth tokens for Google Calendar per practice
- `crisis_alerts` — logged crisis detections with phrases, transcript snippet, alert status
- `users` — auth users linked to practices with roles
- `app_settings` — feature flags (e.g., `signups_enabled` kill switch)

## Working Conventions

### Git & Deploy
- Push directly to main for small fixes. Branch + squash merge for larger features.
- **After every push to main:** verify Railway deploy goes green. Read build logs if it fails. Fix and re-push. Do not stop at "merged."
- Both services (`harbor-app` and `hospitable-fascination`) deploy on push to main.

### Code Patterns
- TypeScript strict mode throughout
- `supabaseAdmin` (service role) for server-side DB operations in API routes
- `createClient()` (from `@/lib/supabase-server`) for auth-scoped operations
- Server components by default; `'use client'` only when hooks/interactivity required
- API routes return proper HTTP status codes with `{ error: string }` JSON on failure
- Non-fatal operations (logging, analytics) wrapped in try/catch to avoid breaking the happy path

### Admin & Diagnostics
All `/api/admin/*` routes require `Authorization: Bearer <CRON_SECRET>` header.
- `/api/admin/practices` — list all practices with full provisioning state
- `/api/admin/call-diag?practice_id=...` — call logs, intake forms, appointments
- `/api/admin/calendar-diag` — calendar connections, token health, test events
- `/api/admin/repair-practice` — fix broken provisioning
- `/api/admin/reprovision` — re-run Twilio+Vapi setup for a practice
- `/api/admin/signups` — view signup attempts, retry failed ones

### Live Practices
- **Harbor Demo:** `172405dd-65f9-46ce-88e9-104c68d24da4` — phone +15415023993, Chance's test practice
- **Hope & Harmony Counseling:** `be434edc-22d0-4907-95b0-86928bde1805` — phone +15415394890, Dr. Trace Wonser (Chance's mom), first real practice

## Current Status (April 18, 2026)

### Launch Blockers
- ~~**A2P 10DLC:** Twilio campaign CM8e8461ae~~ **APPROVED 4/20/26 by Bella at Twilio.** Outbound SMS unlocks when `SMS_ENABLED=true` is set on the harbor-app Railway service.
- **Mom's calendar:** Needs to reconnect Google Calendar via dashboard settings now that OAuth consent screen is published to production.

### Today's Focus
- End-to-end testing with demo practice (call → book → calendar → intake → dashboard)
- Stedi API integration for real-time insurance eligibility verification
- Battle-testing every flow before mom's test week begins

### Recently Shipped
- Unified 3-tier crisis detection with shared phrase lists
- Google OAuth branding verified and published (no more "unverified app" warning)
- Removed dead `/api/billing/create-checkout` endpoint (had silent provisioning bug)
- Tier 1+2 AI data moat (28 new columns, 3 new tables, transcript analyzer)
- SMS consent form (.docx + .pdf) for TCPA compliance
- Full pre-launch readiness audit — all 10 critical flows verified

### Coming Soon
- Stedi insurance eligibility integration
- Rebrand from "Receptionist" to "Office" (getharboroffice.com) — AFTER A2P approval
- PostHog activation (`NEXT_PUBLIC_POSTHOG_KEY` env var not yet set in Railway)
- HIPAA BAA with Vapi when ready for their enterprise plan
- Ellie voice tuning — name spelling accuracy needs improvement

## Environment Variables
Required in Railway for production:

**Core:** NEXT_PUBLIC_APP_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY

**Billing:** STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_ID_FOUNDING, STRIPE_PRICE_ID_REGULAR

**Voice/SMS:** VAPI_API_KEY, VAPI_WEBHOOK_SECRET, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN

**Email:** RESEND_API_KEY, RESEND_FROM_EMAIL

**AI:** ANTHROPIC_API_KEY (for crisis Sonnet calls in voice-server)

**Insurance:** STEDI_API_KEY (new — for eligibility checks)

**Analytics:** NEXT_PUBLIC_GTM_ID, NEXT_PUBLIC_CLARITY_ID, NEXT_PUBLIC_POSTHOG_KEY (not yet set)

**Admin:** CRON_SECRET (Bearer token for /api/admin/* and /api/cron/*)

