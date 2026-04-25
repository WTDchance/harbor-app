// app/api/patients/[id]/billing-mode/route.ts
// Harbor — Switch a patient's billing mode with audit + insurance_record side effects.
// POST /api/patients/[id]/billing-mode
// Body: { billing_mode: 'pending'|'insurance'|'self_pay'|'sliding_scale', reason?: string }
//
// Side effects:
// - Switching TO self_pay: archives any active insurance_records for this patient.
//   (The records are kept for audit; the eligibility-precheck cron uses billing_mode
//   to decide whether to verify, so archiving is redundant-but-explicit.)
// - Switching TO insurance: reactivates the most recent archived insurance_record
//   if one exists. Does NOT create a new record — if the patient truly has new
//   coverage, the insurance panel UI handles that separately.
// - Switching FROM insurance TO self_pay requires a non-empty reason (UX contract;
//   enforced here so callers can't skip it).
//
// Uses supabaseAdmin throughout because the dashboard mutates practice data via
// the act-as cookie, and user-scoped clients silently fail under RLS in that path
// (ref: memory feedback_rls_actAs).

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase";
import { resolvePracticeIdForApi } from "@/lib/active-practice";
import { requireApiSession } from '@/lib/aws/api-auth'

const ALLOWED_MODES = ["pending", "insurance", "self_pay", "sliding_scale"] as const;
type BillingMode = (typeof ALLOWED_MODES)[number];

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

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { user, error: authError } = await getAuthenticatedUser(req);
  if (authError || !user) {
    return NextResponse.json({ error: authError }, { status: 401 });
  }

  const practiceId = await resolvePracticeIdForApi(supabase, user);
  if (!practiceId) {
    return NextResponse.json({ error: "Practice not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const newMode = body?.billing_mode as BillingMode | undefined;
  const reason: string | null =
    typeof body?.reason === "string" && body.reason.trim() !== ""
      ? body.reason.trim()
      : null;

  if (!newMode || !ALLOWED_MODES.includes(newMode)) {
    return NextResponse.json(
      { error: `Invalid billing_mode. Must be one of: ${ALLOWED_MODES.join(", ")}` },
      { status: 400 }
    );
  }

  // Load current patient, scoped to the active practice.
  const { data: patient, error: patientErr } = await supabase
    .from("patients")
    .select("id, billing_mode")
    .eq("id", params.id)
    .eq("practice_id", practiceId)
    .single();

  if (patientErr || !patient) {
    return NextResponse.json({ error: "Patient not found" }, { status: 404 });
  }

  const currentMode: BillingMode =
    (patient.billing_mode as BillingMode) || "pending";

  if (currentMode === newMode) {
    return NextResponse.json(
      { error: `Patient is already in '${newMode}' mode.` },
      { status: 400 }
    );
  }

  // UX contract: switching from insurance -> self_pay must include a reason.
  if (currentMode === "insurance" && newMode === "self_pay" && !reason) {
    return NextResponse.json(
      { error: "A reason is required when switching a patient from insurance to self-pay." },
      { status: 400 }
    );
  }

  const now = new Date().toISOString();

  // 1. Update the patient row.
  const { data: updated, error: updateErr } = await supabase
    .from("patients")
    .update({
      billing_mode: newMode,
      billing_mode_changed_at: now,
      billing_mode_changed_reason: reason,
      updated_at: now,
    })
    .eq("id", params.id)
    .eq("practice_id", practiceId)
    .select("id, billing_mode, billing_mode_changed_at, billing_mode_changed_reason")
    .single();

  if (updateErr || !updated) {
    return NextResponse.json(
      { error: updateErr?.message || "Failed to update billing mode" },
      { status: 500 }
    );
  }

  // 2. Side effects on insurance_records. Non-fatal — log and continue.
  let insuranceSideEffect: string | null = null;

  if (newMode === "self_pay" || newMode === "sliding_scale") {
    // Archive any active records for this patient.
    const { data: archived, error: archErr } = await supabase
      .from("insurance_records")
      .update({ status: "archived", updated_at: now })
      .eq("patient_id", params.id)
      .eq("practice_id", practiceId)
      .eq("status", "active")
      .select("id");

    if (archErr) {
      console.error("[billing-mode] archive failed:", archErr);
    } else if (archived && archived.length > 0) {
      insuranceSideEffect = `archived ${archived.length} active insurance record${archived.length > 1 ? "s" : ""}`;
    }
  } else if (newMode === "insurance") {
    // Reactivate the most recently archived record, if one exists.
    const { data: candidates, error: candErr } = await supabase
      .from("insurance_records")
      .select("id, updated_at")
      .eq("patient_id", params.id)
      .eq("practice_id", practiceId)
      .eq("status", "archived")
      .order("updated_at", { ascending: false })
      .limit(1);

    if (candErr) {
      console.error("[billing-mode] lookup archived failed:", candErr);
    } else if (candidates && candidates.length > 0) {
      const { error: reactErr } = await supabase
        .from("insurance_records")
        .update({ status: "active", updated_at: now })
        .eq("id", candidates[0].id);

      if (reactErr) {
        console.error("[billing-mode] reactivate failed:", reactErr);
      } else {
        insuranceSideEffect = "reactivated most recent archived insurance record";
      }
    }
  }

  return NextResponse.json({
    success: true,
    patient: updated,
    previous_mode: currentMode,
    insurance_side_effect: insuranceSideEffect,
  });
}
