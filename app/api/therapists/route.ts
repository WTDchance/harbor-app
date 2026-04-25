// app/api/therapists/route.ts
// Harbor — Therapist roster for the active practice.
// GET  /api/therapists         → list all therapists on the practice (active + inactive)
// POST /api/therapists         → create a new therapist
//
// Writes go through supabaseAdmin because the dashboard uses the act-as cookie;
// user-scoped clients silently fail under RLS in that path (feedback_rls_actAs).

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase";
import { resolvePracticeIdForApi } from "@/lib/active-practice";
import { requireApiSession } from '@/lib/aws/api-auth'

const BIO_SOFT_CAP = 1500;

async function getAuthenticatedUser(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { user: null, error: "Missing or invalid authorization header" };
  }
  const token = authHeader.slice(7);
  const __ctx = await requireApiSession();
  if (__ctx instanceof NextResponse) return __ctx;
  const user = { id: __ctx.user.id, email: __ctx.session.email };
  if (error || !user) return { user: null, error: "Unauthorized" };
  return { user, error: null };
}

export async function GET(req: NextRequest) {
  const { user, error: authError } = await getAuthenticatedUser(req);
  if (authError || !user) return NextResponse.json({ error: authError }, { status: 401 });

  const practiceId = await resolvePracticeIdForApi(supabase, user);
  if (!practiceId) return NextResponse.json({ error: "Practice not found" }, { status: 404 });

  const { data, error } = await supabase
    .from("therapists")
    .select("id, display_name, credentials, bio, is_primary, is_active, created_at, updated_at")
    .eq("practice_id", practiceId)
    .order("is_active", { ascending: false })
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ therapists: data || [] });
}

export async function POST(req: NextRequest) {
  const { user, error: authError } = await getAuthenticatedUser(req);
  if (authError || !user) return NextResponse.json({ error: authError }, { status: 401 });

  const practiceId = await resolvePracticeIdForApi(supabase, user);
  if (!practiceId) return NextResponse.json({ error: "Practice not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const display_name = (body?.display_name || "").toString().trim();
  const credentials = body?.credentials ? body.credentials.toString().trim() : null;
  const bio = body?.bio ? body.bio.toString() : null;
  const is_primary = body?.is_primary === true;
  const is_active = body?.is_active !== false; // default true

  if (!display_name) {
    return NextResponse.json({ error: "display_name is required" }, { status: 400 });
  }
  if (bio && bio.length > BIO_SOFT_CAP * 2) {
    // The UI soft-caps at 1500. Server enforces a looser 3000-char hard ceiling
    // so we never end up with a multi-KB prompt section.
    return NextResponse.json(
      { error: `Bio is too long (max ${BIO_SOFT_CAP * 2} chars on the server; UI soft-caps at ${BIO_SOFT_CAP}).` },
      { status: 400 }
    );
  }

  // If creating a primary, demote any existing primary on this practice first.
  if (is_primary) {
    const { error: demoteErr } = await supabase
      .from("therapists")
      .update({ is_primary: false, updated_at: new Date().toISOString() })
      .eq("practice_id", practiceId)
      .eq("is_primary", true);
    if (demoteErr) {
      return NextResponse.json({ error: `Demote failed: ${demoteErr.message}` }, { status: 500 });
    }
  }

  const { data, error } = await supabase
    .from("therapists")
    .insert({
      practice_id: practiceId,
      display_name,
      credentials,
      bio,
      is_primary,
      is_active,
    })
    .select("id, display_name, credentials, bio, is_primary, is_active, created_at, updated_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ therapist: data }, { status: 201 });
}
