# Harbor Key Management & Rotation Policy

**HIPAA Reference:** 45 CFR 164.312(a)(2)(iv) — Encryption and Decryption; 45 CFR 164.312(e)(2)(ii) — Encryption  
**Last Updated:** 2026-04-16  
**Owner:** Chance Wonser, Founder  
**Review Cadence:** Quarterly

---

## 1. Purpose

This policy defines how Harbor manages, stores, rotates, and revokes cryptographic keys and API credentials that protect Protected Health Information (PHI). All team members with access to production systems must follow this policy.

## 2. Key Inventory

| Key / Secret | Service | Scope | Storage Location | Rotation Schedule |
|-------------|---------|-------|-----------------|-------------------|
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase | Full DB access (bypasses RLS) | Railway env vars | Every 6 months or on team change |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase | Client-side DB access (RLS enforced) | Railway env vars | Every 6 months or on team change |
| `SUPABASE_URL` | Supabase | Database endpoint | Railway env vars | N/A (tied to project) |
| `VAPI_API_KEY` | Vapi | Voice AI assistant management | Railway env vars | Every 6 months or on team change |
| `TWILIO_ACCOUNT_SID` | Twilio | SMS/voice telephony | Railway env vars | N/A (account identifier) |
| `TWILIO_AUTH_TOKEN` | Twilio | SMS/voice telephony | Railway env vars | Every 6 months or on team change |
| `STRIPE_SECRET_KEY` | Stripe | Billing operations | Railway env vars | Every 12 months or on compromise |
| `STRIPE_WEBHOOK_SECRET` | Stripe | Webhook verification | Railway env vars | Every 12 months or on compromise |
| `RESEND_API_KEY` | Resend | Transactional email | Railway env vars | Every 12 months or on compromise |
| `RECONCILER_SECRET` | Harbor (internal) | Cron job authentication | Railway env vars | Every 6 months or on team change |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google | Calendar OAuth integration | Railway env vars | Every 12 months or on compromise |
| GitHub PAT | GitHub | CI/CD deploy | Railway env vars | Every 90 days (GitHub policy) |

## 3. Storage Requirements

- **Production secrets** are stored exclusively in Railway environment variables. Railway encrypts environment variables at rest and in transit.
- **Never** commit secrets to source code, configuration files, or documentation.
- **Never** store secrets in browser localStorage, cookies, or client-side code (except `NEXT_PUBLIC_*` keys which are designed for client exposure and protected by RLS).
- **Never** transmit secrets over unencrypted channels (email, Slack, SMS). Use a secure sharing tool (1Password, Bitwarden) for one-time credential transfers.

## 4. Rotation Procedures

### 4.1 Supabase Keys

1. Navigate to Supabase Dashboard → Settings → API.
2. Click "Generate new keys" to create new `anon` and `service_role` keys.
3. Update both keys in Railway environment variables.
4. Trigger a Railway redeploy.
5. Verify application health: test login, API calls, and cron jobs.
6. Old keys are automatically invalidated by Supabase.

### 4.2 Twilio Auth Token

1. Navigate to Twilio Console → Account → API keys and tokens.
2. Click "Request a Secondary Auth Token."
3. Update `TWILIO_AUTH_TOKEN` in Railway environment variables.
4. Redeploy and verify SMS sending + webhook validation.
5. Revoke the primary (old) token in Twilio once verified.

### 4.3 Vapi API Key

1. Navigate to Vapi Dashboard → Settings → API Keys.
2. Generate a new API key.
3. Update `VAPI_API_KEY` in Railway environment variables.
4. Redeploy and verify assistant provisioning + webhook flow.
5. Delete the old key in Vapi dashboard.

### 4.4 Stripe Keys

1. Navigate to Stripe Dashboard → Developers → API Keys.
2. Roll the secret key (Stripe supports rolling with a grace period).
3. Update `STRIPE_SECRET_KEY` in Railway.
4. For webhook secret: create a new webhook endpoint or roll the signing secret.
5. Redeploy and verify a test subscription flow.

### 4.5 Resend API Key

1. Navigate to Resend Dashboard → API Keys.
2. Create a new API key with the same permissions.
3. Update `RESEND_API_KEY` in Railway.
4. Redeploy and send a test email.
5. Delete the old key in Resend.

### 4.6 Internal Secrets (RECONCILER_SECRET)

1. Generate a new random string: `openssl rand -hex 32`
2. Update `RECONCILER_SECRET` in Railway environment variables.
3. Redeploy. All cron jobs use the new value automatically.

## 5. Emergency Rotation (Compromise Response)

If any key is suspected compromised:

1. **Immediately** rotate the compromised key using the procedures above.
2. **Review** audit logs for unauthorized access during the exposure window.
3. **Assess** whether PHI was accessed or exfiltrated.
4. **Document** the incident, timeline, and actions taken.
5. **If PHI was exposed:** Follow the breach notification process in the Backup/DR plan.

## 6. Access Control

- Only the founder (Chance Wonser) has direct access to Railway environment variables.
- Service accounts (CI/CD) use scoped tokens with minimum necessary permissions.
- When a team member with production access departs, all secrets they had access to must be rotated within 24 hours.

## 7. Encryption at Rest & In Transit

| Layer | Mechanism | Managed By |
|-------|-----------|------------|
| Database | AES-256 encryption at rest | Supabase |
| Database connections | TLS 1.2+ enforced | Supabase |
| Application traffic | TLS 1.2+ via HSTS (preload) | Cloudflare + Railway |
| API communications | HTTPS only (all third-party APIs) | Vapi, Twilio, Stripe, Resend |
| Backups | AES-256 encrypted | Supabase |

## 8. Audit & Compliance

- All key rotation events should be logged in the Harbor audit log.
- This policy is reviewed quarterly alongside the Backup/DR plan.
- Key inventory is verified against actual Railway environment variables during each review.

## 9. Document History

| Date | Change | Author |
|------|--------|--------|
| 2026-04-16 | Initial version | Chance Wonser / Claude |
