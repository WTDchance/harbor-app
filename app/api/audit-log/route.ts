// HIPAA Audit Log API — §164.312(b)
// Accepts audit events from authenticated users and server-side callers.
// All writes go through supabaseAdmin (service role) so authenticated
// users cannot tamper with the audit trail.

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { supabaseAdmin } from "@/lib/supabase";
import { checkBruteForce } from "@/lib/breach-detection";

// ---- helpers ----------------------------------------------------------------

function getClientIp(req: NextRequest): string | null {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    null
  );
}

// ---- POST /api/audit-log ----------------------------------------------------

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, resource_type, resource_id, details, severity } = body;

    if (!action) {
      return NextResponse.json({ error: "action is required" }, { status: 400 });
    }

    // Resolve the calling user (if authenticated)
    let userId: string | null = null;
    let userEmail: string | null = null;
    let practiceId: string | null = null;

    // Try to extract user from Supabase session cookies
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return req.cookies.getAll();
          },
          setAll() {}, // read-only — we don't set cookies here
        },
      }
    );

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      userId = user.id;
      userEmail = user.email ?? null;

      // Look up practice_id
      const { data: userRecord } = await supabaseAdmin
        .from("users")
        .select("practice_id")
        .eq("id", user.id)
        .single();
      practiceId = userRecord?.practice_id ?? null;
    }

    // Allow callers to override practice_id (admin endpoints acting on behalf)
    if (body.practice_id) {
      practiceId = body.practice_id;
    }

    const { error } = await supabaseAdmin.from("audit_logs").insert({
      user_id: userId,
      user_email: userEmail,
      practice_id: practiceId,
      action,
      resource_type: resource_type || null,
      resource_id: resource_id || null,
      details: details || {},
      ip_address: getClientIp(req),
      user_agent: req.headers.get("user-agent") || null,
      severity: severity || "info",
    });

    if (error) {
      console.error("[audit-log] insert error:", error);
      // Never block the caller — audit failures are logged but non-fatal
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    // Breach detection: check for brute-force on failed logins
    if (action === "login_failed") {
      const clientIp = getClientIp(req);
      if (clientIp) {
        checkBruteForce(clientIp, req.headers.get("user-agent")).catch(() => {});
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("[audit-log] unexpected error:", err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

// ---- GET /api/audit-log (practice-scoped read) ------------------------------

export async function GET(req: NextRequest) {
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll() {},
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Find practice
  const { data: userRecord } = await supabaseAdmin
    .from("users")
    .select("practice_id")
    .eq("id", user.id)
    .single();

  if (!userRecord?.practice_id) {
    return NextResponse.json({ error: "No practice found" }, { status: 404 });
  }

  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "100"), 500);
  const offset = parseInt(url.searchParams.get("offset") || "0");
  const actionFilter = url.searchParams.get("action");

  let query = supabaseAdmin
    .from("audit_logs")
    .select("*", { count: "exact" })
    .eq("practice_id", userRecord.practice_id)
    .order("timestamp", { ascending: false })
    .range(offset, offset + limit - 1);

  if (actionFilter) {
    query = query.eq("action", actionFilter);
  }

  const { data, count, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ logs: data, total: count });
}
