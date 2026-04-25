// app/api/intake/documents/upload/route.ts
// Harbor — Upload PDF/document to Supabase Storage for intake documents
// POST: Upload a file and return the public URL

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase";
import { resolvePracticeIdForApi } from "@/lib/active-practice";

async function getPracticeId(req: NextRequest): Promise<{ practiceId: string | null; error: string | null }> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { practiceId: null, error: "Missing authorization" };
  }
  const token = authHeader.slice(7);
  const { data: { user }, error } = await supabase.auth.getUser(token);
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

export async function POST(req: NextRequest) {
  const { practiceId, error } = await getPracticeId(req);
  if (!practiceId) return NextResponse.json({ error }, { status: error === "Unauthorized" ? 401 : 404 });

  const formData = await req.formData();
  const file = formData.get("file") as File | null;

  if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });

  // Only allow PDF and common document types
  const allowedTypes = ["application/pdf", "image/png", "image/jpeg"];
  if (!allowedTypes.includes(file.type)) {
    return NextResponse.json({ error: "Only PDF, PNG, and JPEG files are allowed" }, { status: 400 });
  }

  // Max 10MB
  if (file.size > 10 * 1024 * 1024) {
    return NextResponse.json({ error: "File must be under 10MB" }, { status: 400 });
  }

  const ext = file.name.split(".").pop() || "pdf";
  const fileName = `${practiceId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const { error: uploadError } = await supabase.storage
    .from("intake-documents")
    .upload(fileName, buffer, {
      contentType: file.type,
      upsert: false,
    });

  if (uploadError) {
    console.error("Upload error:", uploadError);
    return NextResponse.json({ error: "Failed to upload file" }, { status: 500 });
  }

  const { data: urlData } = supabase.storage
    .from("intake-documents")
    .getPublicUrl(fileName);

  return NextResponse.json({
    url: urlData.publicUrl,
    fileName: file.name,
    size: file.size,
  });
}

