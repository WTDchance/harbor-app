// app/api/intake/submissions/[id]/route.ts
// Harbor — Intake Submission Detail API
// GET /api/intake/submissions/[id]
// Returns full submission data including scores, patient info, and document signatures

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

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { user, error } = await getAuthenticatedUser(req);
  if (!user) {
    return NextResponse.json({ error }, { status: 401 });
  }

  const { data: userRecord } = await supabase
    .from("users")
    .select("practice_id")
    .eq("id", user.id)
    .single();

  if (!userRecord?.practice_id) return NextResponse.json({ error: "Practice not found" }, { status: 404 });
  const practiceId = userRecord.practice_id;

  const { data: submission, error: queryError } = await supabase
    .from("intake_forms")
    .select(
      `id, status, token,
       patient_name, patient_phone, patient_email, patient_dob, patient_address,
       phq9_answers, phq9_score, phq9_severity,
       gad7_answers, gad7_score, gad7_severity,
       additional_notes, completed_at, created_at,
       intake_document_signatures(
         id, signed_name, signed_at, additional_fields,
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
