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

  // Look up practice via users table
  const { data: userRecord } = await supabase
    .from("users")
    .select("practice_id")
    .eq("id", user.id)
    .single();

  if (!userRecord?.practice_id) {
    return NextResponse.json({ error: "Practice not found" }, { status: 404 });
  }

  const practiceId = userRecord.practice_id;

  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search")?.toLowerCase().trim();

  // 1. Get ALL patients for this practice from the patients table
  const { data: patients, error: patientsError } = await supabase
    .from("patients")
    .select("id, first_name, last_name, phone, email, date_of_birth, created_at")
    .eq("practice_id", practiceId)
    .order("created_at", { ascending: false });

  if (patientsError) {
    return NextResponse.json({ error: patientsError.message }, { status: 500 });
  }

  // 2. Get completed intake forms to enrich patient data with screening scores
  const { data: forms } = await supabase
    .from("intake_forms")
    .select(
      `id, patient_name, patient_email, patient_phone, patient_dob,
       phq9_score, phq9_severity, gad7_score, gad7_severity, status, completed_at`
    )
    .eq("practice_id", practiceId)
    .order("completed_at", { ascending: false });

  // 3. Get pending/sent intake forms to show intake status for patients who haven't completed yet
  const { data: pendingForms } = await supabase
    .from("intake_forms")
    .select("id, patient_phone, patient_name, status, created_at")
    .eq("practice_id", practiceId)
    .in("status", ["pending", "sent", "opened"]);

  // Build a map of intake data by phone number for enrichment
  const intakeByPhone = new Map<
    string,
    {
      intake_status: string;
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

  // Process completed forms first
  if (forms) {
    for (const form of forms) {
      const phone = form.patient_phone?.replace(/\D/g, "");
      if (!phone) continue;

      if (!intakeByPhone.has(phone)) {
        intakeByPhone.set(phone, {
          intake_status: "completed",
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

      const entry = intakeByPhone.get(phone)!;

      if (form.status === "completed") {
        entry.intake_count++;

        // First completed entry (newest) sets the "latest" values
        if (entry.last_seen === null && form.completed_at) {
          entry.last_seen = form.completed_at;
          entry.latest_phq9_score = form.phq9_score;
          entry.latest_phq9_severity = form.phq9_severity;
          entry.latest_gad7_score = form.gad7_score;
          entry.latest_gad7_severity = form.gad7_severity;
        }

        // Build chronological history
        if (form.completed_at) {
          if (form.phq9_score !== null) {
            entry.phq9_history.unshift({ date: form.completed_at, score: form.phq9_score });
          }
          if (form.gad7_score !== null) {
            entry.gad7_history.unshift({ date: form.completed_at, score: form.gad7_score });
          }
        }
      }
    }
  }

  // Mark patients with pending intake forms
  if (pendingForms) {
    for (const form of pendingForms) {
      const phone = form.patient_phone?.replace(/\D/g, "");
      if (!phone) continue;

      if (!intakeByPhone.has(phone)) {
        intakeByPhone.set(phone, {
          intake_status: form.status, // "pending", "sent", or "opened"
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
    }
  }

  // 4. Build the patient list from the patients table, enriched with intake data
  let result = (patients || []).map((p) => {
    const normalizedPhone = p.phone?.replace(/\D/g, "") || "";
    const intake = intakeByPhone.get(normalizedPhone);
    const fullName = [p.first_name, p.last_name].filter(Boolean).join(" ") || null;

    return {
      key: p.id,
      patient_name: fullName,
      patient_email: p.email,
      patient_phone: p.phone,
      patient_dob: p.date_of_birth,
      intake_status: intake?.intake_status || "none", // "completed", "pending", "sent", "opened", or "none"
      intake_count: intake?.intake_count || 0,
      last_seen: intake?.last_seen || p.created_at,
      latest_phq9_score: intake?.latest_phq9_score || null,
      latest_phq9_severity: intake?.latest_phq9_severity || null,
      latest_gad7_score: intake?.latest_gad7_score || null,
      latest_gad7_severity: intake?.latest_gad7_severity || null,
      phq9_history: intake?.phq9_history || [],
      gad7_history: intake?.gad7_history || [],
      created_at: p.created_at,
    };
  });

  // 5. Apply search filter
  if (search) {
    result = result.filter(
      (p) =>
        p.patient_name?.toLowerCase().includes(search) ||
        p.patient_email?.toLowerCase().includes(search) ||
        p.patient_phone?.includes(search)
    );
  }

  // 6. Sort by last_seen descending (most recent activity first)
  result.sort((a, b) => {
    if (!a.last_seen && !b.last_seen) return 0;
    if (!a.last_seen) return 1;
    if (!b.last_seen) return -1;
    return b.last_seen.localeCompare(a.last_seen);
  });

  return NextResponse.json({ patients: result, total: result.length });
}
