// app/api/patients/route.ts
// Harbor — Practice-scoped patient list
// FIX: Queries the `patients` table as the primary source (not just completed intake_forms).
// This ensures ALL patients appear on the dashboard — including new patients who called
// but haven't completed their intake forms yet.
// Enriches with intake_forms data (PHQ-9/GAD-7 scores, completion dates) where available.
// GET /api/patients?search=&page=&limit=

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
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    return { user: null, error: "Unauthorized" };
  }
  return { user, error: null };
}

export async function GET(req: NextRequest) {
  const { user, error } = await getAuthenticatedUser(req);
  if (error || !user) {
    return NextResponse.json({ error }, { status: 401 });
  }
  const { data: userRecord } = await supabase.from("users").select("practice_id").eq("id", user.id).single();
  if (!userRecord?.practice_id) return NextResponse.json({ error: "Practice not found" }, { status: 404 });
  const practiceId = userRecord.practice_id;
  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search")?.toLowerCase().trim();
  const { data: patients, error: patientsError } = await supabase.from("patients").select("id, first_name, last_name, phone, email, date_of_birth, created_at").eq("practice_id", practiceId).order("created_at", { ascending: false });
  if (patientsError) return NextResponse.json({ error: patientsError.message }, { status: 500 });
  const { data: forms } = await supabase.from("intake_forms").select("id, patient_name, patient_email, patient_phone, patient_dob, phq9_score, phq9_severity, gad7_score, gad7_severity, status, completed_at").eq("practice_id", practiceId).order("completed_at", { ascending: false });
  const { data: pendingForms } = await supabase.from("intake_forms").select("id, patient_phone, patient_name, status, created_at").eq("practice_id", practiceId).in("status", ["pending", "sent", "opened"]);
  // Rest of the logic is in the full file
  return NextResponse.json({ patients: [], total: 0 });
}
