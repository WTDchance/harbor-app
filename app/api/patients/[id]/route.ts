// app/api/patients/[id]/route.ts
// Harbor — Full patient profile
// [id] is base64url of the patient's email (or phone/name as fallback key)
// GET /api/patients/[id]

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

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { user, error } = await getAuthenticatedUser(req);
  if (!user) return NextResponse.json({ error }, { status: 401 });

  const { data: practice } = await supabase
    .from("practices")
    .select("id")
    .eq("user_id", user.id)
    .single();

  if (!practice) return NextResponse.json({ error: "Practice not found" }, { status: 404 });

  // Decode the patient key from base64url
  let patientKey: string;
  try {
    patientKey = Buffer.from(params.id, "base64url").toString("utf8");
  } catch {
    return NextResponse.json({ error: "Invalid patient ID" }, { status: 400 });
  }

  // Fetch all intake forms for this practice that match the patient key
  const { data: allForms, error: formsError } = await supabase
    .from("intake_forms")
    .select(
      `id, patient_name, patient_email, patient_phone, patient_dob, patient_address,
       phq9_answers, phq9_score, phq9_severity,
       gad7_answers, gad7_score, gad7_severity,
       additional_notes, completed_at, created_at, status, appointment_id,
       intake_document_signatures(
         id, signed_name, signed_at,
         intake_documents(id, name, requires_signature)
       )`
    )
    .eq("practice_id", practice.id)
    .eq("status", "completed")
    .order("completed_at", { ascending: false });

  if (formsError) return NextResponse.json({ error: formsError.message }, { status: 500 });

  // Filter to forms matching this patient key (email / phone / name)
  const patientForms = (allForms ?? []).filter((form) => {
    const key =
      form.patient_email?.toLowerCase() ||
      form.patient_phone ||
      form.patient_name ||
      form.id;
    return key === patientKey;
  });

  if (patientForms.length === 0) {
    return NextResponse.json({ error: "Patient not found" }, { status: 404 });
  }

  // Most recent form supplies the canonical demographics
  const latest = patientForms[0];

  // Fetch linked appointments for context
  const appointmentIds = patientForms
    .map((f) => f.appointment_id)
    .filter(Boolean) as string[];

  let appointments: {
    id: string;
    scheduled_at: string;
    appointment_type: string;
    status: string;
    providers: { full_name: string } | null;
  }[] = [];

  if (appointmentIds.length > 0) {
    const { data: appts } = await supabase
      .from("appointments")
      .select("id, scheduled_at, appointment_type, status, providers:provider_id(full_name)")
      .in("id", appointmentIds)
      .order("scheduled_at", { ascending: false });
    appointments = (appts ?? []) as typeof appointments;
  }

  // Build outcome history (chronological, oldest first)
  const outcomeHistory = [...patientForms]
    .filter((f) => f.completed_at)
    .reverse()
    .map((f) => ({
      intake_form_id: f.id,
      date: f.completed_at!,
      phq9_score: f.phq9_score,
      phq9_severity: f.phq9_severity,
      gad7_score: f.gad7_score,
      gad7_severity: f.gad7_severity,
    }));

  return NextResponse.json({
    patient: {
      key: patientKey,
      patient_name: latest.patient_name,
      patient_email: latest.patient_email,
      patient_phone: latest.patient_phone,
      patient_dob: latest.patient_dob,
      patient_address: latest.patient_address,
      intake_count: patientForms.length,
      last_seen: latest.completed_at,
    },
    intake_forms: patientForms,
    appointments,
    outcome_history: outcomeHistory,
  });
}
