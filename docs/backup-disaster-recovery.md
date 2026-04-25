# Harbor Backup & Disaster Recovery Plan

**HIPAA Reference:** 45 CFR 164.308(a)(7) — Contingency Plan  
**Last Updated:** 2026-04-16  
**Owner:** Chance Wonser, Founder  
**Review Cadence:** Quarterly or after any infrastructure change

---

## 1. Scope

This plan covers all systems that store, process, or transmit Protected Health Information (PHI) for Harbor Receptionist. It documents backup mechanisms, recovery objectives, and procedures for restoring service after a disruption.

## 2. Infrastructure Overview

| Component | Provider | Data Stored |
|-----------|----------|-------------|
| Application (Next.js) | Railway | No persistent data — stateless containers |
| Database (PostgreSQL) | Supabase (Pro plan) | All PHI: call logs, patient records, intake submissions, SMS conversations, audit logs |
| Voice AI | Vapi | Call audio (transient — not retained post-processing) |
| SMS/Voice Telephony | Twilio | Message logs (retained per Twilio policy) |
| Payments | Stripe | Subscription metadata (no PHI) |
| Email | Resend | Transactional email logs (no PHI in body) |
| Source Code | GitHub | Application code (no PHI) |
| DNS/CDN | Cloudflare | No data storage |

## 3. Backup Strategy

### 3.1 Database (Supabase PostgreSQL)

**Automatic backups provided by Supabase Pro plan:**
- **Point-in-Time Recovery (PITR):** Enabled. Continuous WAL archiving allows recovery to any point within the retention window.
- **Retention:** 7 days of point-in-time recovery.
- **Daily snapshots:** Automated daily logical backups retained for 7 days.
- **Encryption:** Backups are encrypted at rest using AES-256.
- **Location:** Supabase manages backup storage in the same region as the primary database.

**What is backed up:**
- All tables including PHI (patients, call_logs, sms_conversations, intake_submissions, audit_logs)
- Row Level Security policies and functions
- Database schema and indexes

### 3.2 Application Code (GitHub)

- **Full git history** retained indefinitely.
- **Branch protection** on `main` — requires PR review before merge.
- **Auto-deploy** from `main` to Railway on merge.

### 3.3 Environment Configuration

- **Railway environment variables** (API keys, secrets) are managed through Railway's dashboard and are backed by their infrastructure.
- **Recommendation:** Maintain an encrypted offline copy of all environment variables. Review quarterly.

### 3.4 Third-Party Services

Vapi, Twilio, Stripe, and Resend each maintain their own backup and redundancy systems per their respective BAAs and SLAs. Harbor does not back up data held by these providers — their retention policies govern.

## 4. Recovery Objectives

| Metric | Target | Rationale |
|--------|--------|-----------|
| **Recovery Point Objective (RPO)** | < 24 hours | Supabase PITR allows recovery to within minutes; daily snapshots provide worst-case 24h data loss |
| **Recovery Time Objective (RTO)** | < 4 hours | Railway redeploy from GitHub takes ~5 minutes; Supabase restore takes 1-3 hours |
| **Maximum Tolerable Downtime** | 8 hours | Based on practice operating hours; after-hours calls queue in Twilio |

## 5. Disaster Recovery Procedures

### 5.1 Database Corruption or Accidental Deletion

1. **Assess** the scope of data loss (which tables, time range).
2. **Initiate PITR** through Supabase dashboard — restore to the last known-good timestamp.
3. **Verify** restored data by spot-checking recent records.
4. **Re-run** the data retention cron if restoration included expired data.
5. **Document** the incident in the audit log.

### 5.2 Application Failure (Railway)

1. Railway auto-restarts failed containers. If persistent:
2. **Check** build logs in Railway dashboard.
3. **Rollback** to the last successful deploy via Railway's deploy history.
4. **If Railway is down:** Deploy to a backup hosting provider (Vercel, Render) using the same GitHub repo and environment variables.

### 5.3 Complete Infrastructure Failure

1. **Provision** a new Supabase project and restore from the latest backup.
2. **Deploy** the application to Railway (or alternative) from GitHub `main`.
3. **Update** DNS records in Cloudflare to point to the new deployment.
4. **Reconfigure** Twilio webhooks and Vapi server URLs to the new domain.
5. **Notify** affected practices within 24 hours of the incident.

### 5.4 Third-Party Service Outage

| Service | Impact | Mitigation |
|---------|--------|------------|
| Vapi outage | Calls not answered by AI | Twilio forwards to practice fallback number |
| Twilio outage | No inbound calls/SMS | Patients call practice directly; SMS queues |
| Supabase outage | Dashboard inaccessible | Read-only mode if replica available; wait for restoration |
| Railway outage | Full app downtime | Redeploy to Vercel/Render from GitHub |

## 6. Data Retention & Disposal

Per our published privacy policy and HIPAA requirements:

| Data Type | Retention Period | Disposal Method |
|-----------|-----------------|-----------------|
| Call logs & transcripts | 90 days | Automated cron deletion (`/api/cron/data-retention`) |
| SMS conversations | 90 days | Automated cron deletion |
| Audit logs | 365 days | Automated cron deletion |
| Patient records | Until practice requests deletion | Manual via admin API |
| Intake submissions | Indefinite (clinical records) | Manual deletion on practice request |

## 7. Testing & Validation

- **Quarterly:** Verify Supabase backup status and PITR availability in dashboard.
- **Quarterly:** Confirm Railway deploy-from-rollback works.
- **Annually:** Perform a full DR drill — restore database to a staging environment and verify data integrity.
- **After infrastructure changes:** Review and update this document.

## 8. Incident Response Integration

Any disaster or data loss event triggers the breach notification process documented in our HIPAA compliance page:

1. **Assess** whether PHI was exposed or lost.
2. **Notify** affected practices within 60 days per HIPAA Breach Notification Rule (§164.404).
3. **Document** the incident, response actions, and outcome in the audit log.
4. **Review** and update this DR plan based on lessons learned.

## 9. Roles & Responsibilities

| Role | Responsibility |
|------|---------------|
| Founder (Chance Wonser) | DR plan owner, incident commander, practice notifications |
| Engineering (Claude AI) | Technical recovery execution, code rollback, DB restoration |
| Supabase Support | Database backup/restore assistance |
| Railway Support | Platform incident resolution |

## 10. Document History

| Date | Change | Author |
|------|--------|--------|
| 2026-04-16 | Initial version | Chance Wonser / Claude |
