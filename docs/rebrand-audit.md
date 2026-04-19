# Rebrand Audit: `harborreceptionist.com` → `harboroffice.ai`

Point-in-time snapshot as of 2026-04-19. Scope: every reference to the current production domain, categorized by what it takes to cut over.

**Cutover plan:** Do not flip DNS until the post–A2P 10DLC window. Until then, this doc is the pre-staging punch list. When we flip, we work through each category in order.

---

## Category 1 — Already env-driven (just change the value)

These already read from `NEXT_PUBLIC_APP_URL` (or `APP_URL` in voice-server) with `https://harborreceptionist.com` as the fallback. Changing the env var in Railway flips them automatically. No code change strictly required, but the fallback string should be updated to `https://harboroffice.ai` at the same time so local dev and failover match.

**Files with `NEXT_PUBLIC_APP_URL || 'https://harborreceptionist.com'`:**

- `app/api/appointments/route.ts`
- `app/api/admin/call-diag/route.ts`
- `app/api/admin/health/route.ts`
- `app/api/admin/repair-practice/route.ts` (2 occurrences)
- `app/api/cron/weekly-eligibility-email/route.ts`
- `app/api/cron/reconcile/route.ts`
- `app/api/cron/intake-reminders/route.ts`
- `app/api/integrations/google-calendar/callback/route.ts`
- `app/api/intake/create/route.ts`
- `app/api/intake/send/route.ts`
- `app/api/intake/resend/route.ts`
- `app/api/signup/route.ts`
- `app/api/vapi/webhook/route.ts`
- `lib/email.ts` (2 occurrences)
- `lib/reminders.ts`
- `lib/weekly-report.ts`
- `lib/vapi-provision.ts`

**Voice-server uses a different env var name** — note this discrepancy:

- `voice-server/src/server.ts`: `process.env.APP_URL || 'https://harborreceptionist.com'`
  - Railway env var for voice-server is `APP_URL`, not `NEXT_PUBLIC_APP_URL`. Update both services at the same time.

**Resend sender addresses** (env-overridable but fallback to harborreceptionist.com):

- `lib/email.ts` — `EMAIL_CHANCE`, `EMAIL_SALES`, `EMAIL_SUPPORT` all use `RESEND_*_EMAIL` env vars
- `lib/reminder-email.ts` — `RESEND_FROM_EMAIL` fallback is `Harbor <noreply@harborreceptionist.com>`
- **Pre-req:** `harboroffice.ai` must be verified in Resend and the send-from addresses set up before flipping these env vars.

---

## Category 2 — Hardcoded strings (real code changes required)

These have the domain baked in with no env var. Must be edited before cutover.

### High impact — breaks functionality if not updated

- `app/api/practices/forwarding/route.ts:124` — `voiceUrl = \`https://harborreceptionist.com/api/twilio/forward?practice_id=${practice.id}\``. **This is written into each practice's Twilio voice URL.** Refactor to use `NEXT_PUBLIC_APP_URL` fallback, then re-run forwarding setup for every practice (or batch-update via admin script) at cutover.

### Medium impact — iCal UID stability

- `app/api/calendar/feed/route.ts:86` — `UID:harbor-${appt.id}@harborreceptionist.com`
- `app/api/calendar/events/route.ts:159` — `UID:${Date.now()}@harborreceptionist.com`
- **Caution:** iCal UIDs are stable identifiers. Changing the domain here means calendar clients see *new* events instead of updates to existing ones — old events would become orphaned duplicates in every subscribed calendar. **Recommendation: keep the `@harborreceptionist.com` suffix in UIDs even after rebrand** (or migrate to a domain-agnostic UID format like `harbor-${appt.id}@harbor.internal`). Not a user-facing string — it's just an opaque stable ID.

### Low impact — copy, meta, and marketing

Every file below contains user-facing copy, meta tags, or canonical URLs with hardcoded references. These need a find-and-replace at cutover (or, better, centralize to a config constant):

- `app/layout.tsx:6` — `const siteUrl = 'https://harborreceptionist.com'` (meta tags root)
- `app/page.tsx` — logo URL, canonical URL, contact emails (lines 130-135, 219, 602)
- `app/terms/page.tsx` — multiple references
- `app/privacy-policy/page.tsx` — website + email references
- `app/privacy/page.tsx`
- `app/hipaa/page.tsx` — email + website
- `app/sms/page.tsx` — canonical, support email, example intake URL, website
- `app/intake/[token]/page.tsx`
- `app/contact/page.tsx`
- `app/blog/page.tsx`, `app/blog/[slug]/page.tsx`
- `public/opt-in-proof.html` — Privacy Policy + SMS Terms links
- `public/og-image.svg` — SVG text content (needs a new version of the OG image)
- `app/api/signup/route.ts:78` — waitlist fallback email copy (`hello@harborreceptionist.com`)
- `app/api/admin/email-health/route.ts:75` — `"Support@harborreceptionist.com"` literal

**Refactor suggestion:** Add `lib/site-config.ts` with constants: `SITE_URL`, `SUPPORT_EMAIL`, `SALES_EMAIL`, `OG_IMAGE_URL`. Import these everywhere instead of hardcoding. Single flip at cutover.

---

## Category 3 — External services requiring manual updates at cutover

None of these can be automated from the repo. Each requires logging into the respective dashboard and changing a URL or domain setting.

- **Stripe** — webhook endpoint URL (Stripe Dashboard → Developers → Webhooks)
- **Vapi** — assistant `serverUrl` for every practice. Either (a) update `lib/vapi-provision.ts` to use the new env var and re-run `/api/admin/repair-practice?action=sync_vapi` for every active practice, or (b) bulk-patch via Vapi API.
- **Twilio** — per-number voice webhook + SMS webhook URLs. Use `lib/twilio-provision.ts` logic to re-sync for every practice with a Twilio number.
- **Google OAuth** — add `https://harboroffice.ai/api/integrations/google-calendar/callback` to the authorized redirect URIs list in Google Cloud Console (keep the old one until every practice has reconnected).
- **Supabase** — update Site URL and Redirect URLs in Authentication → URL Configuration. Keep both domains during transition.
- **Resend** — verify `harboroffice.ai` as a sending domain. Set up the same `chance@`, `sales@`, `support@`, `noreply@` addresses.
- **cron-job.org** — 5 Harbor cron jobs point to `harborreceptionist.com/api/cron/*`. Update each to the new domain.
- **Railway** — update the custom domain from `harborreceptionist.com` to `harboroffice.ai` (keep old as secondary during transition so we can 301 from old → new for a while).
- **Google Cloud Console (OAuth app branding)** — update homepage URL if we want `harboroffice.ai` to be the shown homepage. This is a re-verification trigger, so we only do it after the Google re-verification submission clears.
- **A2P 10DLC campaign (Twilio)** — once approved, confirm the brand/campaign is tied to our Twilio account, not to the domain. If the campaign references harborreceptionist.com specifically, a re-registration may be required.
- **DNS / MX** — set up MX records for `harboroffice.ai` to receive mail (Gmail/Workspace or whatever mail provider you use). Needed before Resend verification.

---

## Category 4 — Documentation

These are informational only — no functional impact, but should be updated for correctness.

- `CLAUDE.md:21` — production URL
- `CLAUDE.md:37` — Railway service → domain mapping
- `README-failsafes.md` — several example URLs
- `.env.example` — `NEXT_PUBLIC_APP_URL`, `RESEND_FROM_EMAIL`, `RESEND_CHANCE_EMAIL`, `RESEND_SALES_EMAIL`, `RESEND_SUPPORT_EMAIL`, Vapi webhook URL comment
- `docs/backup-disaster-recovery.md`

---

## Cutover runbook (when we're ready to flip)

Rough order of operations, each step reversible:

1. Verify `harboroffice.ai` in Resend; set up all four sending addresses.
2. Add Google OAuth redirect URI for the new domain (keep old too).
3. Add the new domain to Supabase auth allowlist (keep old too).
4. Set up Railway custom domain for `harboroffice.ai`. SSL provisioning ~5 min.
5. Merge a PR that does: (a) refactor hardcoded strings in Category 2 to use a `lib/site-config.ts`, (b) refactor the Twilio `forwarding/route.ts` hardcoded URL to use the env var.
6. In Railway, update `NEXT_PUBLIC_APP_URL`, `APP_URL` (voice-server), and all `RESEND_*_EMAIL` env vars to the new domain.
7. Update cron-job.org URLs (5 jobs).
8. Bulk re-sync Vapi assistant `serverUrl` for every practice via `/api/admin/repair-practice`.
9. Bulk re-sync Twilio voice webhook for every practice.
10. Update Stripe webhook URL.
11. Keep `harborreceptionist.com` as a secondary domain with a 301 redirect to `harboroffice.ai` for at least 6 months so all bookmarks, SMS links already sent, and old OAuth flows continue to work.
12. Update `app/api/calendar/feed/route.ts` and `app/api/calendar/events/route.ts` UIDs — **NO, keep these as-is.** iCal UID stability trumps brand consistency.

Estimated total time to execute cutover once all four domains are verified and Category 2 PR is merged: **~2 hours of hands-on work**, ~24 hours of DNS propagation + safety margin.

---

## Open questions

- Do we want `harborreceptionist.com` to eventually redirect users to `harboroffice.ai`, or keep both live long-term? (Affects how aggressive the 301 strategy should be.)
- A2P 10DLC — does flipping domains trigger a new campaign review? Varun at Twilio is the contact.
- Should the 4 cold-email domains (`getharboroffice.com`, `harbor-office.com`, `buyharboroffice.com`, `getharborreceptionist.com`) redirect to `harborreceptionist.com` now and `harboroffice.ai` after cutover? Plan: yes, with a single DNS change at cutover.
