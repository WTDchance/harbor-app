// lib/audit.ts
// HIPAA §164.312(b) — Server-side audit logging helper.
// Use this in API routes and server actions to log PHI access,
// auth events, and admin actions to the immutable audit_logs table.

import { supabaseAdmin } from "@/lib/supabase";

export type AuditSeverity = "info" | "warning" | "critical";

export interface AuditEntry {
  action: string;
  user_id?: string | null;
  user_email?: string | null;
  practice_id?: string | null;
  resource_type?: string | null;
  resource_id?: string | null;
  details?: Record<string, any>;
  ip_address?: string | null;
  user_agent?: string | null;
  severity?: AuditSeverity;
}

/**
 * Write an audit log entry.  Non-throwing — audit failures are logged
 * to stderr but never block the calling operation.
 */
export async function writeAuditLog(entry: AuditEntry): Promise<void> {
  try {
    const { error } = await supabaseAdmin.from("audit_logs").insert({
      user_id: entry.user_id ?? null,
      user_email: entry.user_email ?? null,
      practice_id: entry.practice_id ?? null,
      action: entry.action,
      resource_type: entry.resource_type ?? null,
      resource_id: entry.resource_id ?? null,
      details: entry.details ?? {},
      ip_address: entry.ip_address ?? null,
      user_agent: entry.user_agent ?? null,
      severity: entry.severity ?? "info",
    });
    if (error) {
      console.error("[audit] write failed:", error.message);
    }
  } catch (err: any) {
    console.error("[audit] unexpected error:", err.message);
  }
}

/**
 * Extract client IP from Next.js request headers.
 */
export function extractIp(headers: Headers): string | null {
  return (
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip") ||
    null
  );
}
