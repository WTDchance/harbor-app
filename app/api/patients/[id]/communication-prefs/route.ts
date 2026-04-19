// Per-patient SMS / email / call opt-out state, read and write.
// Backed by three opt-out tables (sms_opt_outs, email_opt_outs, call_opt_outs)
// keyed by (practice_id, phone) or (practice_id, email). One practice-scoped
// endpoint per patient so the dashboard's Communication card can flip each
// channel independently.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase";
import { resolvePracticeIdForApi } from "@/lib/active-practice";
import { isOptedOut as isSmsOptedOut, clearOptOut as clearSmsOptOut } from "@/lib/sms-optout";
import { isEmailOptedOut, recordEmailOptOut, clearEmailOptOut } from "@/lib/email-optout";
import { isCallOptedOut, recordCallOptOut, clearCallOptOut } from "@/lib/call-optout";

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

async function resolvePatient(patientId: string, practiceId: string) {
  const { data: patient } = await supabase
    .from("patients")
    .select("id, practice_id, phone, email")
    .eq("id", patientId)
    .eq("practice_id", practiceId)
    .maybeSingle();
  return patient;
}

async function readPrefs(practiceId: string, phone: string | null, email: string | null) {
  const [smsOut, emailOut, callOut] = await Promise.all([
    phone ? isSmsOptedOut(practiceId, phone) : Promise.resolve(false),
    email ? isEmailOptedOut(practiceId, email) : Promise.resolve(false),
    phone ? isCallOptedOut(practiceId, phone) : Promise.resolve(false),
  ]);
  return {
    sms_opted_out: !!smsOut,
    email_opted_out: !!emailOut,
    call_opted_out: !!callOut,
    phone,
    email,
  };
}

// GET /api/patients/[id]/communication-prefs
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { user, error } = await getAuthenticatedUser(req);
  if (error || !user) return NextResponse.json({ error }, { status: 401 });

  const practiceId = await resolvePracticeIdForApi(supabase, user);
  if (!practiceId) {
    return NextResponse.json({ error: "Practice not found" }, { status: 404 });
  }

  const patient = await resolvePatient(params.id, practiceId);
  if (!patient) {
    return NextResponse.json({ error: "Patient not found" }, { status: 404 });
  }

  const prefs = await readPrefs(patient.practice_id, patient.phone, patient.email);
  return NextResponse.json(prefs);
}

// PATCH /api/patients/[id]/communication-prefs
// Body: { sms_opted_out?: boolean, email_opted_out?: boolean, call_opted_out?: boolean }
// Each field is independent — omit to leave that channel unchanged.
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { user, error } = await getAuthenticatedUser(req);
  if (error || !user) return NextResponse.json({ error }, { status: 401 });

  const practiceId = await resolvePracticeIdForApi(supabase, user);
  if (!practiceId) {
    return NextResponse.json({ error: "Practice not found" }, { status: 404 });
  }

  const patient = await resolvePatient(params.id, practiceId);
  if (!patient) {
    return NextResponse.json({ error: "Patient not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const practiceId = patient.practice_id;
  const phone = patient.phone;
  const email = patient.email;

  // SMS
  if (typeof body.sms_opted_out === "boolean") {
    if (!phone) {
      return NextResponse.json(
        { error: "Cannot change SMS opt-out: patient has no phone number on file." },
        { status: 400 }
      );
    }
    if (body.sms_opted_out) {
      // SMS opt-outs table requires a keyword per its original design; use
      // DASHBOARD as a sentinel so it's distinguishable from inbound STOPs.
      await supabase.from("sms_opt_outs").upsert(
        { practice_id: practiceId, phone, keyword: "DASHBOARD", source: "dashboard" },
        { onConflict: "practice_id,phone" }
      );
    } else {
      await clearSmsOptOut(practiceId, phone);
    }
  }

  // Email
  if (typeof body.email_opted_out === "boolean") {
    if (!email) {
      return NextResponse.json(
        { error: "Cannot change email opt-out: patient has no email on file." },
        { status: 400 }
      );
    }
    if (body.email_opted_out) {
      await recordEmailOptOut(practiceId, email, "dashboard");
    } else {
      await clearEmailOptOut(practiceId, email);
    }
  }

  // Call / DNC
  if (typeof body.call_opted_out === "boolean") {
    if (!phone) {
      return NextResponse.json(
        { error: "Cannot change call opt-out: patient has no phone number on file." },
        { status: 400 }
      );
    }
    if (body.call_opted_out) {
      await recordCallOptOut(practiceId, phone, "dashboard");
    } else {
      await clearCallOptOut(practiceId, phone);
    }
  }

  const prefs = await readPrefs(practiceId, phone, email);
  return NextResponse.json(prefs);
}
