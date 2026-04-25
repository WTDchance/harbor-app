// app/api/intake/documents/route.ts
// Harbor — Practice Intake Documents API
// GET: List all documents for the authenticated practice
// POST: Create a new document
// PATCH: Update a document
// DELETE: Soft-delete (deactivate) a document

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase";
import { resolvePracticeIdForApi } from "@/lib/active-practice";
import { requireApiSession } from '@/lib/aws/api-auth'

async function getPracticeId(req: NextRequest): Promise<{ practiceId: string | null; error: string | null }> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { practiceId: null, error: "Missing authorization" };
  }
  const token = authHeader.slice(7);
  const __ctx = await requireApiSession();
  if (__ctx instanceof NextResponse) return __ctx;
  const user = { id: __ctx.user.id, email: __ctx.session.email };
  if (error || !user) return { practiceId: null, error: "Unauthorized" };

  const resolved = await resolvePracticeIdForApi(supabase, user);
  if (resolved) return { practiceId: resolved, error: null };

  const { data: memberRecord } = await supabase
    .from("practice_members")
    .select("practice_id")
    .eq("user_id", user.id)
    .single();
  if (memberRecord?.practice_id) return { practiceId: memberRecord.practice_id, error: null };

  if (user.email) {
    const { data: practiceRecord } = await supabase
      .from("practices")
      .select("id")
      .eq("notification_email", user.email)
      .single();
    if (practiceRecord?.id) return { practiceId: practiceRecord.id, error: null };
  }

  return { practiceId: null, error: "Practice not found" };
}

export async function GET(req: NextRequest) {
  const { practiceId, error } = await getPracticeId(req);
  if (!practiceId) return NextResponse.json({ error }, { status: error === "Unauthorized" ? 401 : 404 });

  const { data: documents, error: queryError } = await supabase
    .from("intake_documents")
    .select("id, name, requires_signature, content_url, description, active, sort_order, created_at, updated_at")
    .eq("practice_id", practiceId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (queryError) return NextResponse.json({ error: queryError.message }, { status: 500 });
  return NextResponse.json({ documents: documents ?? [] });
}

export async function POST(req: NextRequest) {
  const { practiceId, error } = await getPracticeId(req);
  if (!practiceId) return NextResponse.json({ error }, { status: error === "Unauthorized" ? 401 : 404 });

  const body = await req.json();
  const { name, requires_signature = true, content_url, description } = body;

  if (!name) return NextResponse.json({ error: "Document name is required" }, { status: 400 });

  const { data: existing } = await supabase
    .from("intake_documents")
    .select("sort_order")
    .eq("practice_id", practiceId)
    .order("sort_order", { ascending: false })
    .limit(1);

  const nextOrder = (existing?.[0]?.sort_order ?? -1) + 1;

  const { data: doc, error: insertError } = await supabase
    .from("intake_documents")
    .insert({
      practice_id: practiceId,
      name,
      requires_signature,
      content_url: content_url || null,
      description: description || null,
      active: true,
      sort_order: nextOrder,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });
  return NextResponse.json({ document: doc }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const { practiceId, error } = await getPracticeId(req);
  if (!practiceId) return NextResponse.json({ error }, { status: error === "Unauthorized" ? 401 : 404 });

  const body = await req.json();
  const { id, ...updates } = body;
  if (!id) return NextResponse.json({ error: "Document id is required" }, { status: 400 });

  const allowedFields = ["name", "requires_signature", "content_url", "description", "active", "sort_order"];
  const safeUpdates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const key of allowedFields) {
    if (key in updates) safeUpdates[key] = updates[key];
  }

  const { data: doc, error: updateError } = await supabase
    .from("intake_documents")
    .update(safeUpdates)
    .eq("id", id)
    .eq("practice_id", practiceId)
    .select()
    .single();

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });
  return NextResponse.json({ document: doc });
}

export async function DELETE(req: NextRequest) {
  const { practiceId, error } = await getPracticeId(req);
  if (!practiceId) return NextResponse.json({ error }, { status: error === "Unauthorized" ? 401 : 404 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Document id is required" }, { status: 400 });

  const { error: deleteError } = await supabase
    .from("intake_documents")
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("practice_id", practiceId);

  if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 500 });
  return NextResponse.json({ deleted: true });
}

