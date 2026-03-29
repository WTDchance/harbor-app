// app/api/patients/route.ts
// Harbor — Practice-scoped patient list
// Aggregates unique patients from completed intake_forms for the practice.
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
  if (error || !user) return { user: null, error: "Unauthorized" };
  return { user, error: null };
}

export async function GET(req: NextRequest) {
  const { user, error } = await getAuthenticatedUser(req);
  if (!user) return NextResponse.json({ error }, { status: 401 });

  // Look up practice via users table (practices has no user_id column)
  const { data: userRecord } = await supabase
    .from("users")
    .select("practice_id")
    .eq("id", user.id)
    .single();

  if (!userRecord?.practice_id) return NextResponse.json({ error: "Practice not found" }, { status: 404 });
  const practiceId = userRecord.practice_id;

  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search")?.toLowerCase().trim() ?? "";

  // Pull all completed intake forms for this practice, newest first
  const { data: forms, error: formsError } = await supabase
    .from("intake_forms")
    .select(
      `id, patient_name, patient_email, patient_phone, patient_dob,
       phq9_score, phq9_severity, gad7_score, gad7_severity, completed_at`
    )
    .eq("practice_id", practiceId)
    .eq("status", "completed")
    .not("completed_at", "is", null)
    .order("completed_at", { ascending: false });

  if (formsError) return NextResponse.json({ error: formsError.message }, { status: 500 });

  // Aggregate by email (fall back to phone, then name) to deduplicate patients
  const patientMap = new Map<
    string,
    {
      key: string;
      patient_name: string | null;
      patient_email: string | null;
      patient_phone: string | null;
      patient_dob: string | null;
      intake_count: number;
      last_seen: string | null;
      latest_phq9_score: number | null;
      latest_phq9_severity: string | null;
      latest_gad7_score: number | null;
      latest_gad7_severity: string | null;
      phq9_history: { date: string; score: number }[];
      gad7_history: { date: string; score: number }[];
    }
  >();

  for (const form of forms ?? []) {
    const key =
      form.patient_email?.toLowerCase() ||
      form.patient_phone ||
      form.patient_name ||
      form.id;

    if (!patientMap.has(key)) {
      patientMap.set(key, {
        key,
        patient_name: form.patient_name,
        patient_email: form.patient_email,
        patient_phone: form.patient_phone,
        patient_dob: form.patient_dob,
        intake_count: 0,
        last_seen: null,
        latest_phq9_score: null,
        latest_phq9_severity: null,
        latest_gad7_score: null,
        latest_gad7_severity: null,
        phq9_history: [],
        gad7_history: [],
      });
    }

    const p = patientMap.get(key)!;
    p.intake_count++;

    // First entry (newest) sets the "latest" values
    if (p.last_seen === null) {
      p.last_seen = form.completed_at;
      p.latest_phq9_score = form.phq9_score;
      p.latest_phq9_severity = form.phq9_severity;
      p.latest_gad7_score = form.gad7_score;
      p.latest_gad7_severity = form.gad7_severity;
    }

    // Build chronological history (oldest first for charting)
    if (form.completed_at) {
      if (form.phq9_score !== null) {
        p.phq9_history.unshift({ date: form.completed_at, score: form.phq9_score });
      }
      if (form.gad7_score !== null) {
        p.gad7_history.unshift({ date: form.completed_at, score: form.gad7_score });
      }
    }
  }

  let patients = Array.from(patientMap.values());

  // Apply search filter
  if (search) {
    patients = patients.filter(
      (p) =>
        p.patient_name?.toLowerCase().includes(search) ||
        p.patient_email?.toLowerCase().includes(search) ||
        p.patient_phone?.includes(search)
    );
  }

  // Sort by last_seen descending
  patients.sort((a, b) =>
    (b.last_seen ?? "").localeCompare(a.last_seen ?? "")
  );

  return NextResponse.json({ patients, total: patients.length });
}
