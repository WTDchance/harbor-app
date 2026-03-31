// app/api/intake/submissions/route.ts
// Harbor — Intake Submissions API (practice-scoped list)
// GET /api/intake/submissions
// Query params: page, limit, status (completed|pending|all), from, to, search

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function getAuthenticatedUser(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { user: null, error: "Missing or invalid authorization header" };
  }
  const token = authHeader.slice(7);
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);
  if (error || !user) {
    return { user: null, error: "Unauthorized" };
  }
  return { user, error: null };
}

export async function GET(req: NextRequest) {
  const { user, error } = await getAuthenticatedUser(req);
  if (!user) {
    return NextResponse.json({ error }, { status: 401 });
  }

  // Resolve practice for this user (try multiple methods)
  let practiceId: string | null = null;

  const { data: userRecord } = await supabase
    .from("users")
    .select("practice_id")
    .eq("id", user.id)
    .single();

  if (userRecord?.practice_id) {
    practiceId = userRecord.practice_id;
  }

  if (!practiceId) {
    const { data: memberRecord } = await supabase
      .from("practice_members")
      .select("practice_id")
      .eq("user_id", user.id)
      .single();
    if (memberRecord?.practice_id) practiceId = memberRecord.practice_id;
  }

  if (!practiceId && user.email) {
    const { data: practiceRecord } = await supabase
      .from("practices")
      .select("id")
      .eq("notification_email", user.email)
      .single();
    if (practiceRecord?.id) practiceId = practiceRecord.id;
  }

  if (!practiceId) return NextResponse.json({ error: "Practice not found" }, { status: 404 });

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1"));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? "25")));
  const status = searchParams.get("status") ?? "completed";
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const search = searchParams.get("search")?.trim() ?? "";
  const offset = (page - 1) * limit;

  let query = supabase
    .from("intake_forms")
    .select(
      `id, status,
       patient_name, patient_phone, patient_email, patient_dob,
       phq9_score, phq9_severity,
       gad7_score, gad7_severity,
       completed_at, created_at`,
      { count: "exact" }
    )
    .eq("practice_id", practiceId)
    .order("completed_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (status !== "all") {
    query = query.eq("status", status);
  }
  if (from) query = query.gte("completed_at", from);
  if (to) query = query.lte("completed_at", to + "T23:59:59Z");
  if (search) query = query.ilike("patient_name", `%${search}%`);

  query = query.range(offset, offset + limit - 1);

  const { data: submissions, error: queryError, count } = await query;

  if (queryError) {
    return NextResponse.json({ error: queryError.message }, { status: 500 });
  }

  return NextResponse.json({
    submissions: submissions ?? [],
    pagination: {
      page,
      limit,
      total: count ?? 0,
      total_pages: Math.ceil((count ?? 0) / limit),
    },
  });
}
