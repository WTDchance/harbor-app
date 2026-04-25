// app/api/therapists/[id]/route.ts
// Harbor — Single-therapist operations.
// PATCH  /api/therapists/[id]  → update any field (display_name, credentials, bio, is_primary, is_active)
// DELETE /api/therapists/[id]  → soft-delete (set is_active=false). Real deletes aren't exposed through this route.

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

async function getTherapistInPractice(id: string, practiceId: string) {
  const { data } = await supabase
    .from("therapists")
    .select("id, practice_id, display_name, is_primary, is_active")
    .eq("id", id)
    .eq("practice_id", practiceId)
    .maybeSingle();
  return data;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { user, error: authError } = await getAuthenticatedUser(req);
  if (authError || !user) return NextResponse.json({ error: authError }, { status: 401 });

  const practiceId = await resolvePracticeIdForApi(supabase, user);
  if (!practiceId) return NextResponse.json({ error: "Practice not found" }, { status: 404 });

  const existing = await getTherapistInPractice(params.id, practiceId);
  if (!existing) return NextResponse.json({ error: "Therapist not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));

  const updates: Record<string, any> = {};
  if (typeof body.display_name === "string") {
    const trimmed = body.display_name.trim();
    if (!trimmed) {
      return NextResponse.json({ error: "display_name cannot be empty" }, { status: 400 });
    }
    updates.display_name = trimmed;
  }
  if ("credentials" in body) {
    const val = body.credentials;
    updates.credentials = typeof val === "string" && val.trim() !== "" ? val.trim() : null;
  }
  if ("bio" in body) {
    const val = body.bio;
    const text = typeof val === "string" ? val : "";
    if (text.length > BIO_SOFT_CAP * 2) {
      return NextResponse.json(
        { error: `Bio is too long (max ${BIO_SOFT_CAP * 2} chars on the server; UI soft-caps at ${BIO_SOFT_CAP}).` },
        { status: 400 }
      );
    }
    updates.bio = text.trim() === "" ? null : text;
  }
  if (typeof body.is_primary === "boolean") updates.is_primary = body.is_primary;
  if (typeof body.is_active === "boolean") updates.is_active = body.is_active;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  // Invariant maintenance: if we're promoting this therapist to primary, demote any
  // other primary on the same practice first. Inactive rows don't participate so
  // we can re-promote a previous primary later if needed.
  if (updates.is_primary === true) {
    await supabase
      .from("therapists")
      .update({ is_primary: false, updated_at: new Date().toISOString() })
      .eq("practice_id", practiceId)
      .eq("is_primary", true)
      .neq("id", params.id);
  }

  // If we're deactivating the current primary, also drop is_primary so the
  // partial unique index doesn't prevent a future reactivation.
  if (updates.is_active === false && existing.is_primary) {
    updates.is_primary = false;
  }

  updates.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from("therapists")
    .update(updates)
    .eq("id", params.id)
    .eq("practice_id", practiceId)
    .select("id, display_name, credentials, bio, is_primary, is_active, created_at, updated_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ therapist: data });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { user, error: authError } = await getAuthenticatedUser(req);
  if (authError || !user) return NextResponse.json({ error: authError }, { status: 401 });

  const practiceId = await resolvePracticeIdForApi(supabase, user);
  if (!practiceId) return NextResponse.json({ error: "Practice not found" }, { status: 404 });

  const existing = await getTherapistInPractice(params.id, practiceId);
  if (!existing) return NextResponse.json({ error: "Therapist not found" }, { status: 404 });

  // Soft-delete: flip is_active=false and drop is_primary so another therapist
  // can take over the primary slot without tripping the unique index.
  const { data, error } = await supabase
    .from("therapists")
    .update({
      is_active: false,
      is_primary: false,
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.id)
    .eq("practice_id", practiceId)
    .select("id, display_name, is_primary, is_active")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ therapist: data });
}
