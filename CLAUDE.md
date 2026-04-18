# Harbor — AI Front Office for Therapists

## What This Is
Harbor sells an AI receptionist ("Ellie") that answers calls for therapy practices, screens new patients (PHQ-2/GAD-2), books appointments, and syncs to Google Calendar. Approaching launch as of April 2026.

- **Founder:** Chance Wonser (chancewonser@gmail.com) — you are his software engineer
- **Production:** https://harborreceptionist.com
- **GitHub:** WTDchance/harbor-app

## Tech Stack
- **Framework:** Next.js 14 (app router, TypeScript, Tailwind)
- **Database/Auth:** Supabase (Postgres + @supabase/ssr)
- **Voice:** Vapi (routes calls to Ellie) + Twilio (phone numbers + SMS)
- **AI:** Anthropic SDK (Claude Haiku for voice, Claude Sonnet for crisis analysis)
- **Billing:** Stripe (checkout → webhook → auto-provisioning pipeline)
- **Email:** Resend (verified domain harborreceptionist.com)
- **Calendar:** tsdav (CalDAV) — Google Calendar OAuth integration
- **Analytics:** PostHog (signup funnel), Google Tag Manager, Microsoft Clarity

## Hosting
- **Railway** project "luminous-amazement" (NOT Vercel — older docs are wrong)
  - `harbor-app` service → Next.js app, domain harborreceptionist.com
  - `hospitable-fascination` service → voice-server (separate Dockerfile in voice-server/)
- **Cron:** External via cron-job.org hitting /api/cron/* with Bearer CRON_SECRET

## Architecture — Key Flows

### Self-Service Signup Pipeline
`/api/signup` → creates auth user + practice (pending_payment) + Stripe checkout session
→ Stripe `checkout.session.completed` webhook fires
→ `purchaseTwilioNumber()` → `createVapiAssistant()` → `linkVapiPhoneNumber()`
→ marks practice active → sends welcome email
→ `/api/signup/status` polls until ready, shows phone number on success page

Rollback on failure: releases Twilio number + deletes Vapi assistant, sets status `provisioning_failed`.

### Voice Call Flow
Inbound call → Twilio → Vapi → `assistant-request` webhook → `/api/vapi/webhook` builds dynamic assistant config with latest system prompt from `lib/systemPrompt.ts` → Ellie handles call → `end-of-call-report` webhook → saves transcript, summary, call log → fires transcript analyzer → sends post-call email to therapist

### Calendar Sync
Three booking paths all push to Google Calendar via `lib/calendar/index.ts` router:
- Voice (Vapi webhook) — after extracting appointmentTime
- Manual (dashboard POST /api/appointments)
- SMS agent (lib/sms-ai-agent.ts)

Calendar connections live in `calendar_connections` table (NOT legacy `google_calendar_token` field on practices). Diagnostic endpoint: `/api/admin/calendar-diag`.

### Crisis Detection (3-tier)
- **Tier 1** (`lib/crisis-phrases.ts` IMMEDIATE_CRISIS_PHRASES): Unambiguous phrases → immediate SMS alert to therapist + 988 referral to caller
- **Tier 2** (`lib/crisis-phrases.ts` CONCERN_PHRASES): Ambiguous phrases → logged but no SMS. Voice server sends to Claude Sonnet for contextual analysis
- **Tier 3** (voice-server only): Regex patterns for behavioral signals (canceling all appointments, settling affairs)
- Fail-safe: if Sonnet fails or API key missing, defaults to escalate

## Working Conventions

### Git
- Push directly to main, or branch + squash merge for larger changes
- Always verify Railway deploy goes green after pushing — don't stop at "merged"
- If build fails, fix it and push again before moving on

### Code Style
- TypeScript strict mode
- Supabase admin client (`supabaseAdmin`) for server-side operations
- Server components by default, 'use client' only when needed
- API routes return proper status codes with JSON error messages

### Admin Endpoints
All `/api/admin/*` routes require `Authorization: Bearer <CRON_SECRET>` header.
Key diagnostic endpoints:
- `/api/admin/practices` — list all practices with provisioning state
- `/api/admin/call-diag?practice_id=...` — call logs, intake forms, appointments for a practice
- `/api/admin/calendar-diag` — calendar connection status, ping, test-event
- `/api/admin/repair-practice` — fix provisioning issues
- `/api/admin/reprovision` — re-run Twilio+Vapi setup

### Live Practices
- **Harbor Demo:** practice_id `172405dd-65f9-46ce-88e9-104c68d24da4`, phone +15415023993
- **Hope & Harmony Counseling (Chance's mom):** practice_id `be434edc-22d0-4907-95b0-86928bde1805`, phone +15415394890

## Current Status (April 2026)

### Launch Blockers
- **A2P 10DLC:** Campaign CM8e8461ae under Twilio review. SMS (appointment reminders, intake links) gated until approved.
- **Mom's calendar:** Needs to reconnect Google Calendar now that OAuth consent screen is in production.

### Recently Shipped
- Unified crisis detection with tiered phrase lists
- Google OAuth branding verified and published
- Tier 1+2 AI data moat (28 new columns, 3 new tables, transcript analyzer)
- SMS consent form for TCPA compliance
- Self-service signup with Stripe + auto-provisioning

### Planned
- Rebrand from "Receptionist" to "Office" (getharboroffice.com) — do AFTER A2P approval
- PostHog env var (`NEXT_PUBLIC_POSTHOG_KEY`) needs to be set in Railway for signup funnel tracking
- HIPAA BAA with Vapi (requires their $1k/mo plan) — `hipaaEnabled: true` is commented out in vapi-provision.ts

## Environment Variables
Key vars that must be set in Railway for production:
RESEND_API_KEY, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_ID_FOUNDING, STRIPE_PRICE_ID_REGULAR, VAPI_API_KEY, VAPI_WEBHOOK_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET, NEXT_PUBLIC_APP_URL, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, NEXT_PUBLIC_GTM_ID, NEXT_PUBLIC_CLARITY_ID, NEXT_PUBLIC_POSTHOG_KEY (not yet set), ANTHROPIC_API_KEY (for crisis detection Sonnet calls)
