// app/api/intake/submissions/[id]/route.ts
// Harbor — Intake Submission Detail API
// GET /api/intake/submissions/[id]
// Returns full submission data including scores, patient info, signatures, demographics, insurance

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase";
import { resolvePracticeIdForApi } from "@/lib/active-practice";

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

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { user, error } = await getAuthenticatedUser(req);
  if (!user) {
    return NextResponse.json({ error }, { status: 401 });
  }

  // Resolve practice_id via act-as cookie (admin) or users table fallback
  let practiceId = await resolvePracticeIdForApi(supabase, user);

  // Fallback: Check practice_members table (group practice support)
  if (!practiceId) {
    const { data: memberRecord } = await supabase
      .from("practice_members")
      .select("practice_id")
      .eq("user_id", user.id)
      .single();

    if (memberRecord?.practice_id) {
      practiceId = memberRecord.practice_id;
    }
  }

  // Fallback: Check practices table by notification_email
  if (!practiceId && user.email) {
    const { data: practiceRecord } = await supabase
      .from("practices")
      .select("id")
      .eq("notification_email", user.email)
      .single();

    if (practiceRecord?.id) {
      practiceId = practiceRecord.id;
    }
  }

  if (!practiceId) {
    return NextResponse.json({ error: "Practice not found for this user" }, { status: 404 });
  }

  const { data: submission, error: queryError } = await supabase
    .from("intake_forms")
    .select(
      `id, status, token,
       patient_name, patient_phone, patient_email, patient_dob, patient_address,
       demographics, insurance, signature_data, signed_name,
       phq9_answers, phq9_score, phq9_severity,
       gad7_answers, gad7_score, gad7_severity,
       additional_notes, completed_at, created_at,
       intake_document_signatures(
         id, signed_name, signed_at, signature_image, additional_fields,
         intake_documents(id, name, requires_signature)
       )`
    )
    .eq("id", params.id)
    .eq("practice_id", practiceId)
    .single();

  if (queryError || !submission) {
    return NextResponse.json({ error: "Submission not found" }, { status: 404 });
  }

  return NextResponse.json({ submission });
}
