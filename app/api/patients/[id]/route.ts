// app/api/patients/[id]/route.ts
// Harbor — Full patient profile by UUID
// FIX: Enriches patient record with demographics from completed intake forms
// so every patient has a complete profile page regardless of when they filled out intake.
// GET /api/patients/[id]

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase";
import { resolvePracticeIdForApi } from "@/lib/active-practice";
import { isOptedOut as isSmsOptedOut } from "@/lib/sms-optout";
import { isEmailOptedOut } from "@/lib/email-optout";
import { isCallOptedOut } from "@/lib/call-optout";
import { requireApiSession } from '@/lib/aws/api-auth'

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

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { user, error } = await getAuthenticatedUser(req);
  if (error || !user) {
    return NextResponse.json({ error }, { status: 401 });
  }

  // Look up practice (respects admin act-as cookie)
  const practiceId = await resolvePracticeIdForApi(supabase, user);
  if (!practiceId) {
    return NextResponse.json({ error: "Practice not found" }, { status: 404 });
  }

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

  // 2. Get all intake forms for this patient
  // FIX: Match by patient_id first (direct link), then fall back to phone match
  let intakeForms: any[] = [];

  // Try patient_id match first
  const { data: formsByPatientId } = await supabase
    .from("intake_forms")
    .select(
      `id, patient_name, patient_email, patient_phone, patient_dob,
       phq9_score, phq9_severity, gad7_score, gad7_severity,
       presenting_concerns, medications, medical_history, prior_therapy, substance_use, family_history,
       status, token, created_at, completed_at, expires_at, patient_id`
    )
    .eq("practice_id", practiceId)
    .eq("patient_id", patientId)
    .order("created_at", { ascending: false });

  if (formsByPatientId && formsByPatientId.length > 0) {
    intakeForms = formsByPatientId;
  } else {
    // Fallback: match by phone number (for forms created before patient_id linking)
    const normalizedPhone = patient.phone?.replace(/\D/g, "");
    if (normalizedPhone) {
      const { data: forms } = await supabase
        .from("intake_forms")
        .select(
          `id, patient_name, patient_email, patient_phone, patient_dob,
           phq9_score, phq9_severity, gad7_score, gad7_severity,
           presenting_concerns, medications, medical_history, prior_therapy, substance_use, family_history,
           status, token, created_at, completed_at, expires_at`
        )
        .eq("practice_id", practiceId)
        .order("created_at", { ascending: false });

      intakeForms = (forms || []).filter(
        (f) => f.patient_phone?.replace(/\D/g, "") === normalizedPhone
      );
    }
  }

  // 3. Get call logs for this patient
  const { data: callLogs } = await supabase
    .from("call_logs")
    .select(
      `id, patient_phone, duration_seconds, summary,
       call_type, caller_name, intake_sent, intake_delivery_preference, intake_email,
       crisis_detected, created_at`
    )
    .eq("practice_id", practiceId)
    .eq("patient_id", patientId)
    .order("created_at", { ascending: false })
    .limit(20);

  // 4. Get appointments for this patient
  const { data: appointments } = await supabase
    .from("appointments")
    .select(
      `id, scheduled_at, duration_minutes,
       status, appointment_type, source, patient_name`
    )
    .eq("practice_id", practiceId)
    .eq("patient_id", patientId)
    .order("scheduled_at", { ascending: false })
    .limit(20);

  // 5. Get crisis alerts for this patient
  const { data: crisisAlerts } = await supabase
    .from("crisis_alerts")
    .select("id, call_log_id, patient_phone, triggered_at, sms_sent")
    .eq("practice_id", practiceId)
    .eq("patient_phone", patient.phone)
    .order("triggered_at", { ascending: false })
    .limit(10);

  // 6. Get tasks/messages for this patient
  // tasks columns: id, practice_id, type, patient_name, patient_phone, transcript, summary, status, created_at
  let tasks: any[] = [];
  if (patient.phone) {
    const normalizedPhone = patient.phone.replace(/\D/g, "");
    const { data: allTasks } = await supabase
      .from("tasks")
      .select("id, type, patient_name, patient_phone, summary, status, created_at")
      .eq("practice_id", practiceId)
      .order("created_at", { ascending: false })
      .limit(50);

    tasks = (allTasks || []).filter(
      (t) => t.patient_phone?.replace(/\D/g, "") === normalizedPhone
    ).slice(0, 20);
  }

  // 6b. Latest insurance_records row for this patient + its latest eligibility_check.
  const { data: insRows } = await supabase
    .from("insurance_records")
    .select(
      `id, insurance_company, member_id, group_number,
       subscriber_name, subscriber_dob, relationship_to_subscriber,
       last_verified_at, last_verification_status, next_verify_due, updated_at`
    )
    .eq("practice_id", practiceId)
    .eq("patient_id", patientId)
    .order("updated_at", { ascending: false })
    .limit(1);

  // 6c. Communication preferences (SMS / email / call opt-out state).
  const [smsOut, emailOut, callOut] = await Promise.all([
    patient.phone ? isSmsOptedOut(practiceId, patient.phone) : Promise.resolve(false),
    patient.email ? isEmailOptedOut(practiceId, patient.email) : Promise.resolve(false),
    patient.phone ? isCallOptedOut(practiceId, patient.phone) : Promise.resolve(false),
  ]);
  const communicationPrefs = {
    sms_opted_out: smsOut,
    email_opted_out: emailOut,
    call_opted_out: callOut,
    phone: patient.phone,
    email: patient.email,
  };

  const latestInsurance = insRows?.[0] || null;
  let latestCheck: any = null;
  if (latestInsurance?.id) {
    const { data: checks } = await supabase
      .from("eligibility_checks")
      .select(
        `id, status, is_active, mental_health_covered, copay_amount,
         coinsurance_percent, deductible_total, deductible_met,
         session_limit, sessions_used, prior_auth_required,
         plan_name, coverage_start_date, coverage_end_date,
         payer_id, trigger_source, error_message, checked_at`
      )
      .eq("insurance_record_id", latestInsurance.id)
      .order("checked_at", { ascending: false })
      .limit(1);
    latestCheck = checks?.[0] || null;
  }

  // 7. Build outcome trend data from completed intake forms
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

  // 8. Enrich patient data with demographics from completed intake forms
  const completedIntake = intakeForms.find((f) => f.status === "completed");

  // Determine current intake status
  const pendingIntake = intakeForms.find(
    (f) => f.status === "pending" || f.status === "sent" || f.status === "opened"
  );
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
      email: patient.email || completedIntake?.patient_email || null,
      date_of_birth: patient.date_of_birth || completedIntake?.patient_dob || null,
      insurance_provider: patient.insurance_provider ?? patient.insurance ?? null,
      insurance_member_id: patient.insurance_member_id || null,
      insurance_group_number: patient.insurance_group_number || null,
      notes: patient.notes,
      created_at: patient.created_at,
      // Additional demographics from intake (enrichment)
      address: patient.address || null,
      pronouns: patient.pronouns || null,
      emergency_contact_name: patient.emergency_contact_name || null,
      emergency_contact_phone: patient.emergency_contact_phone || null,
      referral_source: patient.referral_source || null,
      reason_for_seeking: patient.reason_for_seeking || null,
      telehealth_preference: patient.telehealth_preference || null,
      // Status fields
      intake_completed: patient.intake_completed || intakeStatus === 'completed',
      intake_completed_at: patient.intake_completed_at || completedIntake?.completed_at || null,
      // Billing mode (pending | insurance | self_pay | sliding_scale)
      billing_mode: patient.billing_mode || 'pending',
      billing_mode_changed_at: patient.billing_mode_changed_at || null,
      billing_mode_changed_reason: patient.billing_mode_changed_reason || null,
    },
    intake_status: intakeStatus,
    intake_forms: intakeForms.map((f) => ({
      id: f.id,
      status: f.status,
      phq9_score: f.phq9_score,
      phq9_severity: f.phq9_severity,
      gad7_score: f.gad7_score,
      gad7_severity: f.gad7_severity,
      presenting_concerns: f.presenting_concerns || null,
      medications: f.medications || null,
      medical_history: f.medical_history || null,
      prior_therapy: f.prior_therapy || null,
      substance_use: f.substance_use || null,
      family_history: f.family_history || null,
      created_at: f.created_at,
      completed_at: f.completed_at,
    })),
    call_logs: callLogs || [],
    appointments: appointments || [],
    crisis_alerts: crisisAlerts || [],
    tasks: tasks || [],
    outcome_trend: outcomeTrend,
    communication_prefs: communicationPrefs,
    eligibility: latestInsurance
      ? {
          record_id: latestInsurance.id,
          insurance_company: latestInsurance.insurance_company,
          member_id: latestInsurance.member_id,
          group_number: latestInsurance.group_number,
          subscriber_name: latestInsurance.subscriber_name,
          subscriber_dob: latestInsurance.subscriber_dob,
          relationship_to_subscriber: latestInsurance.relationship_to_subscriber,
          last_verified_at: latestInsurance.last_verified_at,
          last_verification_status: latestInsurance.last_verification_status,
          next_verify_due: latestInsurance.next_verify_due,
          latest_check: latestCheck,
        }
      : null,
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

  const practiceId = await resolvePracticeIdForApi(supabase, user);
  if (!practiceId) {
    return NextResponse.json({ error: "Practice not found" }, { status: 404 });
  }

  const body = await req.json();

  // Allow updating all patient fields
  const allowedFields = [
    "first_name",
    "last_name",
    "email",
    "phone",
    "date_of_birth",
    "insurance_provider",
    "insurance_member_id",
    "insurance_group_number",
    "notes",
    "address",
    "pronouns",
    "emergency_contact_name",
    "emergency_contact_phone",
    "referral_source",
    "reason_for_seeking",
    "telehealth_preference",
  ];

  // Fields that must keep their value (never null-out on empty string)
  const requiredFields = new Set(["first_name", "last_name", "phone"]);

  const updates: Record<string, any> = {};
  for (const field of allowedFields) {
    if (field in body) {
      // Convert empty strings to null for optional fields so falsy
      // fallbacks in the GET handler don't resurrect cleared values.
      const val = body[field];
      updates[field] = !requiredFields.has(field) && val === "" ? null : val;
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { error: "No valid fields to update" },
      { status: 400 }
    );
  }

  // Keep legacy `insurance` column in sync with `insurance_provider`
  // so the GET fallback (insurance_provider ?? insurance) doesn't
  // resurrect a value the user just cleared.
  if ("insurance_provider" in updates) {
    updates.insurance = updates.insurance_provider;
  }

  updates.updated_at = new Date().toISOString();

  const { data, error: updateError } = await supabase
    .from("patients")
    .update(updates)
    .eq("id", params.id)
    .eq("practice_id", practiceId)
    .select()
    .single();

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ patient: data });
}
