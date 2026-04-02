// app/api/patients/[id]/route.ts
// Harbor — Full patient profile by UUID
// FIX: Looks up patient by actual UUID from the patients table
// (old version used base64-encoded email/phone, which broke when patients came from calls)
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
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);
  if (error || !user) return { user: null, error: "Unauthorized" };
  return { user, error: null };
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { user, error } = await getAuthenticatedUser(req);
  if (error || !user) {
    return NextResponse.json({ error }, { status: 401 });
  }

  // Look up practice
  const { data: userRecord } = await supabase
    .from("users")
    .select("practice_id")
    .eq("id", user.id)
    .single();

  if (!userRecord?.practice_id) {
    return NextResponse.json({ error: "Practice not found" }, { status: 404 });
  }

  const practiceId = userRecord.practice_id;
  const patientId = params.id;

  // 1. Get patient from patients table
  const { data: patient, error: patientError } = await supabase
    .from("patients")
    .select("*")
    .eq("id", patientId)
    .eq("practice_id", practiceId)
    .single();

  if (patientError || !patient) {
    return NextResponse.json(
      { error: "Patient not found" },
      { status: 404 }
    );
  }

  // 2. Get all intake forms for this patient (by phone match)
  const normalizedPhone = patient.phone?.replace(/\D/g, "");
  let intakeForms: any[] = [];

  if (normalizedPhone) {
    const { data: forms } = await supabase
      .from("intake_forms")
      .select(
        `id, patient_name, patient_email, patient_phone, patient_dob,
         phq9_score, phq9_severity, gad7_score, gad7_severity,
         status, token, created_at, completed_at, expires_at`
      )
      .eq("practice_id", practiceId)
      .order("created_at", { ascending: false });

    // Filter by phone match (normalize both sides)
    intakeForms = (forms || []).filter(
      (f) => f.patient_phone?.replace(/\D/g, "") === normalizedPhone
    );
  }

  // 3. Get call logs for this patient
  const { data: callLogs } = await supabase
    .from("call_logs")
    .select(
      `id, vapi_call_id, caller_phone, duration_seconds, summary,
       new_patient, intake_sent, intake_delivery_preference, intake_email,
       created_at`
    )
    .eq("practice_id", practiceId)
    .eq("patient_id", patientId)
    .order("created_at", { ascending: false })
    .limit(20);

  // 4. Get appointments for this patient
  const { data: appointments } = await supabase
    .from("appointments")
    .select(
      `id, appointment_date, appointment_time, duration_minutes,
       status, provider_name, type, notes, created_at`
    )
    .eq("practice_id", practiceId)
    .eq("patient_id", patientId)
    .order("appointment_date", { ascending: false })
    .limit(20);

  // 5. Get crisis alerts for this patient
  const { data: crisisAlerts } = await supabase
    .from("crisis_alerts")
    .select("id, severity, summary, status, created_at")
    .eq("practice_id", practiceId)
    .eq("patient_phone", patient.phone)
    .order("created_at", { ascending: false })
    .limit(10);

  // 6. Build outcome trend data from completed intake forms
  const outcomeTrend = intakeForms
    .filter((f) => f.status === "completed" && f.completed_at)
    .map((f) => ({
      date: f.completed_at,
      phq9_score: f.phq9_score,
      phq9_severity: f.phq9_severity,
      gad7_score: f.gad7_score,
      gad7_severity: f.gad7_severity,
    }))
    .reverse(); // oldest first for charting

  // Determine current intake status
  const pendingIntake = intakeForms.find(
    (f) => f.status === "pending" || f.status === "sent" || f.status === "opened"
  );
  const completedIntake = intakeForms.find((f) => f.status === "completed");

  const intakeStatus = pendingIntake
    ? pendingIntake.status
    : completedIntake
    ? "completed"
    : "none";

  return NextResponse.json({
    patient: {
      id: patient.id,
      first_name: patient.first_name,
      last_name: patient.last_name,
      phone: patient.phone,
      email: patient.email,
      date_of_birth: patient.date_of_birth,
      insurance_provider: patient.insurance_provider,
      insurance_member_id: patient.insurance_member_id,
      notes: patient.notes,
      created_at: patient.created_at,
    },
    intake_status: intakeStatus,
    intake_forms: intakeForms.map((f) => ({
      id: f.id,
      status: f.status,
      phq9_score: f.phq9_score,
      phq9_severity: f.phq9_severity,
      gad7_score: f.gad7_score,
      gad7_severity: f.gad7_severity,
      created_at: f.created_at,
      completed_at: f.completed_at,
    })),
    call_logs: callLogs || [],
    appointments: appointments || [],
    crisis_alerts: crisisAlerts || [],
    outcome_trend: outcomeTrend,
  });
}

// PATCH — update patient details
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { user, error } = await getAuthenticatedUser(req);
  if (error || !user) {
    return NextResponse.json({ error }, { status: 401 });
  }

  const { data: userRecord } = await supabase
    .from("users")
    .select("practice_id")
    .eq("id", user.id)
    .single();

  if (!userRecord?.practice_id) {
    return NextResponse.json({ error: "Practice not found" }, { status: 404 });
  }

  const body = await req.json();

  // Only allow updating specific fields
  const allowedFields = [
    "first_name",
    "last_name",
    "email",
    "phone",
    "date_of_birth",
    "insurance_provider",
    "insurance_member_id",
    "notes",
  ];

  const updates: Record<string, any> = {};
  for (const field of allowedFields) {
    if (field in body) {
      updates[field] = body[field];
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  updates.updated_at = new Date().toISOString();

  const { data, error: updateError } = await supabase
    .from("patients")
    .update(updates)
    .eq("id", params.id)
    .eq("practice_id", userRecord.practice_id)
    .select()
    .single();

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ patient: data });
}
