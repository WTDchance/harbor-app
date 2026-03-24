// app/api/patients/export/route.ts
// Harbor — Patient CSV export for EHR import
// GET /api/patients/export?format=simplepractice|therapynotes|jane|harbor

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

function escapeCsv(val: string | null | undefined): string {
  if (val === null || val === undefined) return "";
  const s = String(val);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function row(values: (string | null | undefined)[]): string {
  return values.map(escapeCsv).join(",");
}

function splitName(fullName: string | null): { first: string; last: string } {
  if (!fullName) return { first: "", last: "" };
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return { first: parts[0], last: "" };
  const last = parts.pop()!;
  return { first: parts.join(" "), last };
}

function formatDob(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${mm}/${dd}/${d.getUTCFullYear()}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}/${dd}/${d.getFullYear()}`;
}

function parseAddress(addr: string | null): { street: string; city: string; state: string; zip: string } {
  if (!addr) return { street: "", city: "", state: "", zip: "" };
  const match = addr.match(/^(.+),\s*(.+),\s*([A-Z]{2})\s*(\d{5}(?:-\d{4})?)$/);
  if (match) {
    return { street: match[1].trim(), city: match[2].trim(), state: match[3].trim(), zip: match[4].trim() };
  }
  return { street: addr, city: "", state: "", zip: "" };
}

export async function GET(req: NextRequest) {
  const { user, error } = await getAuthenticatedUser(req);
  if (!user) return NextResponse.json({ error }, { status: 401 });

  const { data: practice } = await supabase
    .from("practices")
    .select("id, name")
    .eq("user_id", user.id)
    .single();

  if (!practice) return NextResponse.json({ error: "Practice not found" }, { status: 404 });

  const { searchParams } = new URL(req.url);
  const format = searchParams.get("format") ?? "harbor";

  const { data: forms, error: formsError } = await supabase
    .from("intake_forms")
    .select(
      `id, patient_name, patient_email, patient_phone, patient_dob, patient_address,
       phq9_score, phq9_severity, gad7_score, gad7_severity, completed_at`
    )
    .eq("practice_id", practice.id)
    .eq("status", "completed")
    .not("completed_at", "is", null)
    .order("completed_at", { ascending: false });

  if (formsError) return NextResponse.json({ error: formsError.message }, { status: 500 });

  const patientMap = new Map<string, {
    patient_name: string | null; patient_email: string | null;
    patient_phone: string | null; patient_dob: string | null;
    patient_address: string | null; intake_count: number;
    last_seen: string | null; latest_phq9_score: number | null;
    latest_phq9_severity: string | null; latest_gad7_score: number | null;
    latest_gad7_severity: string | null;
  }>();

  for (const form of forms ?? []) {
    const key = form.patient_email?.toLowerCase() || form.patient_phone || form.patient_name || form.id;
    if (!patientMap.has(key)) {
      patientMap.set(key, {
        patient_name: form.patient_name, patient_email: form.patient_email,
        patient_phone: form.patient_phone, patient_dob: form.patient_dob,
        patient_address: form.patient_address, intake_count: 0,
        last_seen: null, latest_phq9_score: null, latest_phq9_severity: null,
        latest_gad7_score: null, latest_gad7_severity: null,
      });
    }
    const p = patientMap.get(key)!;
    p.intake_count++;
    if (p.last_seen === null) {
      p.last_seen = form.completed_at;
      p.latest_phq9_score = form.phq9_score;
      p.latest_phq9_severity = form.phq9_severity;
      p.latest_gad7_score = form.gad7_score;
      p.latest_gad7_severity = form.gad7_severity;
    }
  }

  const patients = Array.from(patientMap.values());
  const lines: string[] = [];

  switch (format) {
    case "simplepractice": {
      lines.push(row(["First Name","Last Name","Email Address","Phone Number","Date of Birth","Street","City","State","Zip Code"]));
      for (const p of patients) {
        const { first, last } = splitName(p.patient_name);
        const addr = parseAddress(p.patient_address);
        lines.push(row([first, last, p.patient_email, p.patient_phone, formatDob(p.patient_dob), addr.street, addr.city, addr.state, addr.zip]));
      }
      break;
    }
    case "therapynotes": {
      lines.push(row(["First Name","Last Name","Date of Birth","Email","Phone","Address1","City","State","Zip"]));
      for (const p of patients) {
        const { first, last } = splitName(p.patient_name);
        const addr = parseAddress(p.patient_address);
        lines.push(row([first, last, formatDob(p.patient_dob), p.patient_email, p.patient_phone, addr.street, addr.city, addr.state, addr.zip]));
      }
      break;
    }
    case "jane": {
      lines.push(row(["First Name","Last Name","Email","Mobile Phone","Date of Birth","Address Line 1","City","Province","Postal Code"]));
      for (const p of patients) {
        const { first, last } = splitName(p.patient_name);
        const addr = parseAddress(p.patient_address);
        lines.push(row([first, last, p.patient_email, p.patient_phone, formatDob(p.patient_dob), addr.street, addr.city, addr.state, addr.zip]));
      }
      break;
    }
    default: {
      lines.push(row(["Full Name","First Name","Last Name","Email","Phone","Date of Birth","Address","Total Intakes","Last Seen","Latest PHQ-9 Score","Latest PHQ-9 Severity","Latest GAD-7 Score","Latest GAD-7 Severity"]));
      for (const p of patients) {
        const { first, last } = splitName(p.patient_name);
        lines.push(row([
          p.patient_name, first, last,
          p.patient_email, p.patient_phone, formatDob(p.patient_dob), p.patient_address,
          String(p.intake_count), formatDate(p.last_seen),
          p.latest_phq9_score !== null ? String(p.latest_phq9_score) : "",
          p.latest_phq9_severity,
          p.latest_gad7_score !== null ? String(p.latest_gad7_score) : "",
          p.latest_gad7_severity,
        ]));
      }
      break;
    }
  }

  const csv = lines.join("\r\n");
  const filename = `harbor-patients-${format}-${new Date().toISOString().slice(0, 10)}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
