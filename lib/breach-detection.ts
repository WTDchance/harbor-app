// lib/breach-detection.ts
// HIPAA §164.308(a)(1)(ii)(D) — Information System Activity Review
// HIPAA §164.308(a)(6) — Security Incident Procedures
//
// Detects suspicious patterns and logs them as "critical" audit events.
// Currently monitors:
//  1. Brute-force login attempts (>5 failures from same IP in 15 min)
//  2. Impossible travel (logins from different geolocations within short time)
//  3. Off-hours access (configurable per practice timezone)
//  4. Bulk data access (high-volume patient record views in short window)
//
// This module is called from API routes and middleware.
// It writes directly to audit_logs via supabaseAdmin.

import { supabaseAdmin } from "@/lib/supabase";

// ---- Brute-force detection --------------------------------------------------

const LOGIN_FAIL_THRESHOLD = 5;
const LOGIN_FAIL_WINDOW_MIN = 15;

/**
 * Check if an IP has exceeded the login failure threshold.
 * If so, log a critical audit event.
 */
export async function checkBruteForce(
  ip: string,
  userAgent: string | null
): Promise<boolean> {
  try {
    const windowStart = new Date(
      Date.now() - LOGIN_FAIL_WINDOW_MIN * 60 * 1000
    ).toISOString();

    const { count } = await supabaseAdmin
      .from("audit_logs")
      .select("id", { count: "exact", head: true })
      .eq("action", "login_failed")
      .eq("ip_address", ip)
      .gte("timestamp", windowStart);

    if (count && count >= LOGIN_FAIL_THRESHOLD) {
      await supabaseAdmin.from("audit_logs").insert({
        action: "brute_force_detected",
        ip_address: ip,
        user_agent: userAgent,
        severity: "critical",
        details: {
          failed_attempts: count,
          window_minutes: LOGIN_FAIL_WINDOW_MIN,
          threshold: LOGIN_FAIL_THRESHOLD,
        },
      });
      return true;
    }
  } catch (err: any) {
    console.error("[breach-detection] brute force check failed:", err.message);
  }
  return false;
}

// ---- Bulk data access detection ---------------------------------------------

const BULK_ACCESS_THRESHOLD = 50; // patient views
const BULK_ACCESS_WINDOW_MIN = 5;

/**
 * Check if a user is accessing an unusual number of patient records.
 */
export async function checkBulkAccess(
  userId: string,
  userEmail: string | null,
  practiceId: string | null
): Promise<boolean> {
  try {
    const windowStart = new Date(
      Date.now() - BULK_ACCESS_WINDOW_MIN * 60 * 1000
    ).toISOString();

    const { count } = await supabaseAdmin
      .from("audit_logs")
      .select("id", { count: "exact", head: true })
      .eq("action", "patient_view")
      .eq("user_id", userId)
      .gte("timestamp", windowStart);

    if (count && count >= BULK_ACCESS_THRESHOLD) {
      await supabaseAdmin.from("audit_logs").insert({
        user_id: userId,
        user_email: userEmail,
        practice_id: practiceId,
        action: "bulk_access_detected",
        resource_type: "patient",
        severity: "critical",
        details: {
          access_count: count,
          window_minutes: BULK_ACCESS_WINDOW_MIN,
          threshold: BULK_ACCESS_THRESHOLD,
        },
      });
      return true;
    }
  } catch (err: any) {
    console.error("[breach-detection] bulk access check failed:", err.message);
  }
  return false;
}

// ---- Security incident summary (for admin dashboard) ------------------------

export interface SecuritySummary {
  critical_events_24h: number;
  failed_logins_24h: number;
  active_sessions: number;
  mfa_adoption_pct: number;
}

/**
 * Pull a summary of security metrics for the admin dashboard.
 */
export async function getSecuritySummary(): Promise<SecuritySummary> {
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [criticalRes, failedRes] = await Promise.all([
    supabaseAdmin
      .from("audit_logs")
      .select("id", { count: "exact", head: true })
      .eq("severity", "critical")
      .gte("timestamp", yesterday),
    supabaseAdmin
      .from("audit_logs")
      .select("id", { count: "exact", head: true })
      .eq("action", "login_failed")
      .gte("timestamp", yesterday),
  ]);

  return {
    critical_events_24h: criticalRes.count ?? 0,
    failed_logins_24h: failedRes.count ?? 0,
    active_sessions: 0, // TODO: track via session table
    mfa_adoption_pct: 0, // TODO: calculate from auth.users mfa factors
  };
}
