"use client";
// app/dashboard/patients/[id]/page.tsx
// Harbor - Patient Detail View
// FIX: Uses real patient UUID from patients table (not base64-encoded email/phone)
// Features: patient info, intake status with send/resend action (email or text),
// call history, appointments, outcome trend chart, crisis alerts

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";

const supabase = createClient();

type PatientData = {
  patient: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    phone: string | null;
    email: string | null;
    date_of_birth: string | null;
    insurance_provider: string | null;
    insurance_member_id: string | null;
    notes: string | null;
    created_at: string;
  };
  intake_status: string;
  intake_forms: {
    id: string;
    status: string;
    phq9_score: number | null;
    phq9_severity: string | null;
    gad7_score: number | null;
    gad7_severity: string | null;
    created_at: string;
    completed_at: string | null;
  }[];
  call_logs: {
    id: string;
    caller_phone: string | null;
    duration_seconds: number | null;
    summary: string | null;
    new_patient: boolean;
    intake_sent: boolean;
    created_at: string;
  }[];
  appointments: {
    id: string;
    appointment_date: string;
    appointment_time: string | null;
    duration_minutes: number | null;
    status: string;
    provider_name: string | null;
    type: string | null;
    notes: string | null;
  }[];
  crisis_alerts: {
    id: string;
    severity: string;
    summary: string;
    status: string;
    created_at: string;
  }[];
  outcome_trend: {
    date: string;
    phq9_score: number | null;
    gad7_score: number | null;
  }[];
};

function formatDate(d: string | null) {
  if (!d) return "--";
  return new Date(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatTime(t: string | null) {
  if (!t) return "";
  try {
    const [h, m] = t.split(":").map(Number);
    const ampm = h >= 12 ? "PM" : "AM";
    return `${h % 12 || 12}:${m.toString().padStart(2, "0")} ${ampm}`;
  } catch {
    return t;
  }
}

function formatDuration(seconds: number | null) {
  if (!seconds) return "--";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

function IntakeStatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    completed: "bg-green-100 text-green-800",
    opened: "bg-blue-100 text-blue-800",
    sent: "bg-yellow-100 text-yellow-800",
    pending: "bg-yellow-100 text-yellow-800",
    none: "bg-gray-100 text-gray-600",
  };
  const labels: Record<string, string> = {
    completed: "Completed",
    opened: "Opened",
    sent: "Sent",
    pending: "Pending",
    none: "Not Sent",
  };
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
        colors[status] || colors.none
      }`}
    >
      {labels[status] || status}
    </span>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const colors: Record<string, string> = {
    minimal: "bg-green-100 text-green-800",
    mild: "bg-yellow-100 text-yellow-800",
    moderate: "bg-orange-100 text-orange-800",
    "moderately severe": "bg-red-100 text-red-800",
    severe: "bg-red-200 text-red-900",
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
        colors[severity?.toLowerCase()] || "bg-gray-100 text-gray-600"
      }`}
    >
      {severity || "--"}
    </span>
  );
}

export default function PatientDetailPage() {
  const router = useRouter();
  const params = useParams();
  const patientId = params.id as string;

  const [data, setData] = useState<PatientData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Send intake form state
  const [showSendIntake, setShowSendIntake] = useState(false);
  const [deliveryMethod, setDeliveryMethod] = useState<"sms" | "email">("sms");
  const [intakeEmail, setIntakeEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{
    ok: boolean;
    msg: string;
  } | null>(null);

  useEffect(() => {
    fetchPatient();
  }, [patientId]);

  async function fetchPatient() {
    setLoading(true);
    setError(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        router.push("/login");
        return;
      }

      const res = await fetch(`/api/patients/${patientId}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (!res.ok) {
        const err = await res.json();
        setError(err.error || "Failed to load patient");
        return;
      }

      const json = await res.json();
      setData(json);
      if (json.patient.email) setIntakeEmail(json.patient.email);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function sendIntakeForms() {
    if (!data) return;
    setSending(true);
    setSendResult(null);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;

      const body: Record<string, any> = {
        patient_id: data.patient.id,
        patient_name:
          [data.patient.first_name, data.patient.last_name]
            .filter(Boolean)
            .join(" ") || "Patient",
        patient_phone: data.patient.phone,
        delivery_method: deliveryMethod,
      };

      if (deliveryMethod === "email") {
        body.patient_email = intakeEmail;
      }

      const res = await fetch("/api/intake/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(body),
      });

      const json = await res.json();

      if (!res.ok) {
        setSendResult({ ok: false, msg: json.error || "Failed to send" });
      } else {
        setSendResult({
          ok: true,
          msg: `Intake forms sent via ${deliveryMethod === "sms" ? "text message" : "email"}!`,
        });
        setShowSendIntake(false);
        // Refresh data to show updated status
        setTimeout(fetchPatient, 1000);
      }
    } catch (e: any) {
      setSendResult({ ok: false, msg: e.message });
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <button
          onClick={() => router.back()}
          className="text-teal-600 hover:text-teal-800 mb-4 flex items-center gap-1"
        >
          &larr; Back to Patients
        </button>
        <div className="bg-red-50 text-red-700 p-4 rounded-lg">
          {error || "Patient not found"}
        </div>
      </div>
    );
  }

  const { patient, intake_status, intake_forms, call_logs, appointments, crisis_alerts, outcome_trend } = data;
  const fullName = [patient.first_name, patient.last_name].filter(Boolean).join(" ") || "Unknown Patient";

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <button
            onClick={() => router.back()}
            className="text-teal-600 hover:text-teal-800 mb-2 flex items-center gap-1 text-sm"
          >
            &larr; Back to Patients
          </button>
          <h1 className="text-2xl font-bold text-gray-900">{fullName}</h1>
          <p className="text-gray-500 text-sm">
            Patient since {formatDate(patient.created_at)}
          </p>
        </div>
        <IntakeStatusBadge status={intake_status} />
      </div>

      {/* Crisis alerts banner */}
      {crisis_alerts.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <h3 className="font-semibold text-red-800 mb-2">
            Crisis Alerts ({crisis_alerts.length})
          </h3>
          {crisis_alerts.map((alert) => (
            <div key={alert.id} className="text-sm text-red-700 mb-1">
              <span className="font-medium">{formatDate(alert.created_at)}</span>{" "}
              - {alert.severity}: {alert.summary}
              <span className="ml-2 text-xs bg-red-100 px-1.5 py-0.5 rounded">
                {alert.status}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Patient info + Send Intake */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Contact info card */}
        <div className="bg-white border rounded-lg p-5 shadow-sm">
          <h2 className="font-semibold text-gray-900 mb-3">Contact Info</h2>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Phone</span>
              <span className="font-medium">{patient.phone || "--"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Email</span>
              <span className="font-medium">{patient.email || "--"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Date of Birth</span>
              <span className="font-medium">
                {patient.date_of_birth || "--"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Insurance</span>
              <span className="font-medium">
                {patient.insurance_provider || "--"}
              </span>
            </div>
            {patient.notes && (
              <div className="mt-3 pt-3 border-t">
                <span className="text-gray-500 text-xs block mb-1">Notes</span>
                <p className="text-gray-700">{patient.notes}</p>
              </div>
            )}
          </div>
        </div>

        {/* Intake forms card */}
        <div className="bg-white border rounded-lg p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900">Intake Forms</h2>
            <button
              onClick={() => setShowSendIntake(!showSendIntake)}
              className="text-sm bg-teal-600 text-white px-3 py-1.5 rounded-md hover:bg-teal-700 transition"
            >
              {intake_status === "none" || intake_status === "expired"
                ? "Send Intake Forms"
                : "Resend Intake Forms"}
            </button>
          </div>

          {/* Send intake form UI */}
          {showSendIntake && (
            <div className="bg-teal-50 border border-teal-200 rounded-lg p-4 mb-3">
              <h3 className="font-medium text-teal-900 mb-2">
                How should the patient receive their intake paperwork?
              </h3>
              <div className="flex gap-3 mb-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="delivery"
                    checked={deliveryMethod === "sms"}
                    onChange={() => setDeliveryMethod("sms")}
                    className="text-teal-600"
                  />
                  <span className="text-sm">
                    Text Message {patient.phone ? `(${patient.phone})` : ""}
                  </span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="delivery"
                    checked={deliveryMethod === "email"}
                    onChange={() => setDeliveryMethod("email")}
                    className="text-teal-600"
                  />
                  <span className="text-sm">Email</span>
                </label>
              </div>

              {deliveryMethod === "email" && (
                <input
                  type="email"
                  value={intakeEmail}
                  onChange={(e) => setIntakeEmail(e.target.value)}
                  placeholder="patient@example.com"
                  className="w-full border rounded px-3 py-2 text-sm mb-3"
                />
              )}

              {deliveryMethod === "sms" && !patient.phone && (
                <p className="text-sm text-red-600 mb-2">
                  No phone number on file. Add a phone number first or use
                  email.
                </p>
              )}

              <div className="flex gap-2">
                <button
                  onClick={sendIntakeForms}
                  disabled={
                    sending ||
                    (deliveryMethod === "sms" && !patient.phone) ||
                    (deliveryMethod === "email" && !intakeEmail)
                  }
                  className="bg-teal-600 text-white px-4 py-2 rounded text-sm hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
                >
                  {sending ? "Sending..." : "Send Now"}
                </button>
                <button
                  onClick={() => {
                    setShowSendIntake(false);
                    setSendResult(null);
                  }}
                  className="text-gray-600 px-4 py-2 rounded text-sm hover:bg-gray-100 transition"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Send result message */}
          {sendResult && (
            <div
              className={`p-3 rounded text-sm mb-3 ${
                sendResult.ok
                  ? "bg-green-50 text-green-700"
                  : "bg-red-50 text-red-700"
              }`}
            >
              {sendResult.msg}
            </div>
          )}

          {/* Intake forms list */}
          {intake_forms.length > 0 ? (
            <div className="space-y-2">
              {intake_forms.map((form) => (
                <div
                  key={form.id}
                  className="flex items-center justify-between text-sm border-b py-2 last:border-0"
                >
                  <div>
                    <IntakeStatusBadge status={form.status} />
                    <span className="ml-2 text-gray-500">
                      {formatDate(form.created_at)}
                    </span>
                  </div>
                  {form.status === "completed" && (
                    <div className="flex gap-3">
                      {form.phq9_score !== null && (
                        <span className="text-xs">
                          PHQ-9: <strong>{form.phq9_score}</strong>
                        </span>
                      )}
                      {form.gad7_score !== null && (
                        <span className="text-xs">
                          GAD-7: <strong>{form.gad7_score}</strong>
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500">No intake forms yet.</p>
          )}
        </div>
      </div>

      {/* Outcome trend (if data exists) */}
      {outcome_trend.length > 1 && (
        <div className="bg-white border rounded-lg p-5 shadow-sm">
          <h2 className="font-semibold text-gray-900 mb-3">Outcome Trends</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b">
                  <th className="pb-2">Date</th>
                  <th className="pb-2">PHQ-9</th>
                  <th className="pb-2">Severity</th>
                  <th className="pb-2">GAD-7</th>
                  <th className="pb-2">Severity</th>
                </tr>
              </thead>
              <tbody>
                {outcome_trend.map((point, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="py-2">{formatDate(point.date)}</td>
                    <td className="py-2 font-medium">
                      {point.phq9_score ?? "--"}
                    </td>
                    <td className="py-2">
                      <SeverityBadge
                        severity={
                          (data as any).outcome_trend[i]?.phq9_severity || ""
                        }
                      />
                    </td>
                    <td className="py-2 font-medium">
                      {point.gad7_score ?? "--"}
                    </td>
                    <td className="py-2">
                      <SeverityBadge
                        severity={
                          (data as any).outcome_trend[i]?.gad7_severity || ""
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Call history */}
      <div className="bg-white border rounded-lg p-5 shadow-sm">
        <h2 className="font-semibold text-gray-900 mb-3">
          Call History ({call_logs.length})
        </h2>
        {call_logs.length > 0 ? (
          <div className="space-y-3">
            {call_logs.map((call) => (
              <div key={call.id} className="border-b pb-3 last:border-0">
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">
                      {formatDate(call.created_at)}
                    </span>
                    {call.new_patient && (
                      <span className="bg-blue-100 text-blue-800 text-xs px-1.5 py-0.5 rounded">
                        New Patient
                      </span>
                    )}
                    {call.intake_sent && (
                      <span className="bg-green-100 text-green-800 text-xs px-1.5 py-0.5 rounded">
                        Intake Sent
                      </span>
                    )}
                  </div>
                  <span className="text-gray-500">
                    {formatDuration(call.duration_seconds)}
                  </span>
                </div>
                {call.summary && (
                  <p className="text-sm text-gray-600 mt-1">{call.summary}</p>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-500">No call records.</p>
        )}
      </div>

      {/* Appointments */}
      <div className="bg-white border rounded-lg p-5 shadow-sm">
        <h2 className="font-semibold text-gray-900 mb-3">
          Appointments ({appointments.length})
        </h2>
        {appointments.length > 0 ? (
          <div className="space-y-2">
            {appointments.map((appt) => (
              <div
                key={appt.id}
                className="flex items-center justify-between text-sm border-b pb-2 last:border-0"
              >
                <div>
                  <span className="font-medium">
                    {formatDate(appt.appointment_date)}
                  </span>
                  {appt.appointment_time && (
                    <span className="text-gray-500 ml-1">
                      at {formatTime(appt.appointment_time)}
                    </span>
                  )}
                  {appt.provider_name && (
                    <span className="text-gray-400 ml-2">
                      w/ {appt.provider_name}
                    </span>
                  )}
                </div>
                <span
                  className={`text-xs px-2 py-0.5 rounded ${
                    appt.status === "confirmed"
                      ? "bg-green-100 text-green-800"
                      : appt.status === "cancelled"
                      ? "bg-red-100 text-red-800"
                      : "bg-gray-100 text-gray-600"
                  }`}
                >
                  {appt.status}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-500">No appointments scheduled.</p>
        )}
      </div>
    </div>
  );
}
