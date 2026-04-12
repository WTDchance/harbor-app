"use client";
// app/dashboard/patients/[id]/page.tsx
// Harbor - Patient Detail View
// FIX: Shows FULL patient information from both patients table AND intake demographics.
// Every person is a PATIENT from first contact. Intake enriches their record.
// Features: full patient info card, EDIT PATIENT modal, intake status, call history,
// appointments, outcome trend chart, crisis alerts, tasks/messages

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";
import IntakeProgress from "@/components/IntakeProgress";

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
    insurance_group_number: string | null;
    notes: string | null;
    created_at: string;
    // Enriched demographics
    address: string | null;
    pronouns: string | null;
    emergency_contact_name: string | null;
    emergency_contact_phone: string | null;
    referral_source: string | null;
    reason_for_seeking: string | null;
    telehealth_preference: string | null;
    intake_completed: boolean;
    intake_completed_at: string | null;
  };
  intake_status: string;
  intake_forms: {
    id: string;
    status: string;
    phq9_score: number | null;
    phq9_severity: string | null;
    gad7_score: number | null;
    gad7_severity: string | null;
    presenting_concerns: any | null;
    medications: any | null;
    medical_history: any | null;
    prior_therapy: any | null;
    substance_use: any | null;
    family_history: any | null;
    created_at: string;
    completed_at: string | null;
  }[];
  call_logs: {
    id: string;
    caller_phone: string | null;
    duration_seconds: number | null;
    summary: string | null;
    new_patient: boolean;
    call_type: string | null;
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
  tasks: {
    id: string;
    title: string;
    description: string | null;
    status: string;
    source: string | null;
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
    completed: "Intake Complete",
    opened: "Intake Opened",
    sent: "Intake Sent",
    pending: "Intake Pending",
    none: "Intake Not Sent",
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

function InfoRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex justify-between py-1.5">
      <span className="text-gray-500 text-sm">{label}</span>
      <span className="font-medium text-sm text-right max-w-[60%] truncate">
        {value || "--"}
      </span>
    </div>
  );
}

// ---------- EDIT PATIENT MODAL ----------
function EditPatientModal({
  patient,
  onClose,
  onSaved,
}: {
  patient: PatientData["patient"];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    first_name: patient.first_name || "",
    last_name: patient.last_name || "",
    phone: patient.phone || "",
    email: patient.email || "",
    date_of_birth: patient.date_of_birth || "",
    address: patient.address || "",
    pronouns: patient.pronouns || "",
    insurance_provider: patient.insurance_provider || "",
    insurance_member_id: patient.insurance_member_id || "",
    insurance_group_number: patient.insurance_group_number || "",
    emergency_contact_name: patient.emergency_contact_name || "",
    emergency_contact_phone: patient.emergency_contact_phone || "",
    referral_source: patient.referral_source || "",
    reason_for_seeking: patient.reason_for_seeking || "",
    telehealth_preference: patient.telehealth_preference || "",
    notes: patient.notes || "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) {
    setForm({ ...form, [e.target.name]: e.target.value });
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;

      const res = await fetch(`/api/patients/${patient.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(form),
      });

      if (!res.ok) {
        const json = await res.json();
        setError(json.error || "Failed to save changes");
        return;
      }

      onSaved();
      onClose();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between rounded-t-xl">
          <h2 className="text-lg font-semibold text-gray-900">Edit Patient</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {error && (
            <div className="bg-red-50 text-red-700 p-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          {/* Name */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                First Name
              </label>
              <input
                type="text"
                name="first_name"
                value={form.first_name}
                onChange={handleChange}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Last Name
              </label>
              <input
                type="text"
                name="last_name"
                value={form.last_name}
                onChange={handleChange}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
              />
            </div>
          </div>

          {/* Contact */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Phone
              </label>
              <input
                type="tel"
                name="phone"
                value={form.phone}
                onChange={handleChange}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Email
              </label>
              <input
                type="email"
                name="email"
                value={form.email}
                onChange={handleChange}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
              />
            </div>
          </div>

          {/* DOB & Pronouns */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Date of Birth
              </label>
              <input
                type="date"
                name="date_of_birth"
                value={form.date_of_birth}
                onChange={handleChange}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Pronouns
              </label>
              <input
                type="text"
                name="pronouns"
                value={form.pronouns}
                onChange={handleChange}
                placeholder="e.g., she/her, he/him, they/them"
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
              />
            </div>
          </div>

          {/* Address */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Address
            </label>
            <input
              type="text"
              name="address"
              value={form.address}
              onChange={handleChange}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
            />
          </div>

          {/* Insurance */}
          <div>
            <h3 className="text-sm font-semibold text-gray-800 mb-2">Insurance</h3>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-gray-600 mb-1">Provider</label>
                <input
                  type="text"
                  name="insurance_provider"
                  value={form.insurance_provider}
                  onChange={handleChange}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Member ID</label>
                <input
                  type="text"
                  name="insurance_member_id"
                  value={form.insurance_member_id}
                  onChange={handleChange}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Group #</label>
                <input
                  type="text"
                  name="insurance_group_number"
                  value={form.insurance_group_number}
                  onChange={handleChange}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                />
              </div>
            </div>
          </div>

          {/* Emergency Contact */}
          <div>
            <h3 className="text-sm font-semibold text-gray-800 mb-2">Emergency Contact</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-600 mb-1">Name</label>
                <input
                  type="text"
                  name="emergency_contact_name"
                  value={form.emergency_contact_name}
                  onChange={handleChange}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Phone</label>
                <input
                  type="tel"
                  name="emergency_contact_phone"
                  value={form.emergency_contact_phone}
                  onChange={handleChange}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                />
              </div>
            </div>
          </div>

          {/* Telehealth & Referral */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Telehealth Preference
              </label>
              <select
                name="telehealth_preference"
                value={form.telehealth_preference}
                onChange={handleChange}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
              >
                <option value="">Not specified</option>
                <option value="in-person">In-Person</option>
                <option value="telehealth">Telehealth</option>
                <option value="no preference">No Preference</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Referral Source
              </label>
              <input
                type="text"
                name="referral_source"
                value={form.referral_source}
                onChange={handleChange}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
              />
            </div>
          </div>

          {/* Reason for Seeking Care */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Reason for Seeking Care
            </label>
            <textarea
              name="reason_for_seeking"
              value={form.reason_for_seeking}
              onChange={handleChange}
              rows={2}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent resize-none"
            />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Notes
            </label>
            <textarea
              name="notes"
              value={form.notes}
              onChange={handleChange}
              rows={3}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent resize-none"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-white border-t px-6 py-4 flex justify-end gap-3 rounded-b-xl">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2 text-sm text-white bg-teal-600 rounded-lg hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PatientDetailPage() {
  const router = useRouter();
  const params = useParams();
  const patientId = params.id as string;

  const [data, setData] = useState<PatientData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);

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
          msg: `Intake forms sent via ${
            deliveryMethod === "sms" ? "text message" : "email"
          }!`,
        });
        setShowSendIntake(false);
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

  const {
    patient,
    intake_status,
    intake_forms,
    call_logs,
    appointments,
    crisis_alerts,
    tasks,
    outcome_trend,
  } = data;

  const fullName =
    [patient.first_name, patient.last_name].filter(Boolean).join(" ") ||
    "Unknown Patient";

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      {/* Edit Patient Modal */}
      {showEditModal && (
        <EditPatientModal
          patient={patient}
          onClose={() => setShowEditModal(false)}
          onSaved={() => fetchPatient()}
        />
      )}

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
          <div className="flex items-center gap-3 mt-1">
            <p className="text-gray-500 text-sm">
              Patient since {formatDate(patient.created_at)}
            </p>
            {patient.pronouns && (
              <span className="text-gray-400 text-sm">
                ({patient.pronouns})
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowEditModal(true)}
            className="flex items-center gap-1.5 px-4 py-2 text-sm bg-white border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700 transition shadow-sm"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            Edit Patient
          </button>
          <IntakeStatusBadge status={intake_status} />
        </div>
      </div>

      {/* Crisis alerts banner */}
      {crisis_alerts.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <h3 className="font-semibold text-red-800 mb-2">
            Crisis Alerts ({crisis_alerts.length})
          </h3>
          {crisis_alerts.map((alert) => (
            <div key={alert.id} className="text-sm text-red-700 mb-1">
              <span className="font-medium">
                {formatDate(alert.created_at)}
              </span>{" "}
              - {alert.severity}: {alert.summary}
              <span className="ml-2 text-xs bg-red-100 px-1.5 py-0.5 rounded">
                {alert.status}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Patient Info - FULL DETAILS */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Contact & Personal Info */}
        <div className="bg-white border rounded-lg p-5 shadow-sm">
          <h2 className="font-semibold text-gray-900 mb-3">
            Patient Information
          </h2>
          <div className="divide-y">
            <InfoRow label="Phone" value={patient.phone} />
            <InfoRow label="Email" value={patient.email} />
            <InfoRow
              label="Date of Birth"
              value={
                patient.date_of_birth
                  ? formatDate(patient.date_of_birth)
                  : null
              }
            />
            <InfoRow label="Address" value={patient.address} />
            <InfoRow label="Pronouns" value={patient.pronouns} />
            <InfoRow label="Referral Source" value={patient.referral_source} />
            {patient.reason_for_seeking && (
              <div className="py-2">
                <span className="text-gray-500 text-sm block mb-1">
                  Reason for Seeking Care
                </span>
                <p className="text-sm text-gray-700">
                  {patient.reason_for_seeking}
                </p>
              </div>
            )}
            {patient.telehealth_preference && (
              <InfoRow
                label="Telehealth Preference"
                value={patient.telehealth_preference}
              />
            )}
          </div>
        </div>

        {/* Insurance & Emergency Contact */}
        <div className="space-y-6">
          <div className="bg-white border rounded-lg p-5 shadow-sm">
            <h2 className="font-semibold text-gray-900 mb-3">Insurance</h2>
            <div className="divide-y">
              <InfoRow
                label="Provider"
                value={patient.insurance_provider}
              />
              <InfoRow
                label="Member ID"
                value={patient.insurance_member_id}
              />
              <InfoRow
                label="Group Number"
                value={patient.insurance_group_number}
              />
            </div>
          </div>

          <div className="bg-white border rounded-lg p-5 shadow-sm">
            <h2 className="font-semibold text-gray-900 mb-3">
              Emergency Contact
            </h2>
            <div className="divide-y">
              <InfoRow
                label="Name"
                value={patient.emergency_contact_name}
              />
              <InfoRow
                label="Phone"
                value={patient.emergency_contact_phone}
              />
            </div>
          </div>

          {patient.notes && (
            <div className="bg-white border rounded-lg p-5 shadow-sm">
              <h2 className="font-semibold text-gray-900 mb-3">Notes</h2>
              <p className="text-sm text-gray-700">{patient.notes}</p>
            </div>
          )}
        </div>
      </div>

      {/* Intake Packet Progress (new) */}
      <IntakeProgress patientId={patient.id} />

      {/* Intake Forms Section */}
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
                  Text Message{" "}
                  {patient.phone ? `(${patient.phone})` : ""}
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
                  {form.completed_at && (
                    <span className="ml-1 text-gray-400">
                      (completed {formatDate(form.completed_at)})
                    </span>
                  )}
                </div>
                {form.status === "completed" && (
                  <div className="flex gap-3">
                    {form.phq9_score !== null && (
                      <span className="text-xs">
                        PHQ-9: <strong>{form.phq9_score}</strong>{" "}
                        <SeverityBadge
                          severity={form.phq9_severity || ""}
                        />
                      </span>
                    )}
                    {form.gad7_score !== null && (
                      <span className="text-xs">
                        GAD-7: <strong>{form.gad7_score}</strong>{" "}
                        <SeverityBadge
                          severity={form.gad7_severity || ""}
                        />
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

      {/* Clinical Intake Data (from completed intake forms) */}
      {(() => {
        const completedForm = intake_forms.find(f => f.status === 'completed' && (
          f.presenting_concerns || f.medications || f.medical_history ||
          f.prior_therapy || f.substance_use || f.family_history
        ));
        if (!completedForm) return null;
        return (
          <div className="space-y-6">
            {/* Presenting Concerns */}
            {completedForm.presenting_concerns && (
              <div className="bg-white border rounded-lg p-5 shadow-sm">
                <h2 className="font-semibold text-gray-900 mb-3">Presenting Concerns</h2>
                <div className="space-y-2 text-sm">
                  {completedForm.presenting_concerns.primary_concern && (
                    <div>
                      <span className="text-gray-500">Primary Concern:</span>
                      <p className="text-gray-800 mt-0.5">{completedForm.presenting_concerns.primary_concern}</p>
                    </div>
                  )}
                  {completedForm.presenting_concerns.goals && (
                    <div>
                      <span className="text-gray-500">Goals for Therapy:</span>
                      <p className="text-gray-800 mt-0.5">{completedForm.presenting_concerns.goals}</p>
                    </div>
                  )}
                  {completedForm.presenting_concerns.symptom_duration && (
                    <InfoRow label="Symptom Duration" value={completedForm.presenting_concerns.symptom_duration} />
                  )}
                  {completedForm.presenting_concerns.coping_strategies && (
                    <div>
                      <span className="text-gray-500">Current Coping Strategies:</span>
                      <p className="text-gray-800 mt-0.5">{completedForm.presenting_concerns.coping_strategies}</p>
                    </div>
                  )}
                  {completedForm.presenting_concerns.current_risk && completedForm.presenting_concerns.current_risk !== 'none' && (
                    <div className="bg-amber-50 border border-amber-200 rounded p-2 mt-2">
                      <span className="text-amber-800 font-medium">Risk Indicator: </span>
                      <span className="text-amber-700 capitalize">{completedForm.presenting_concerns.current_risk}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Medications */}
            {completedForm.medications && (
              <div className="bg-white border rounded-lg p-5 shadow-sm">
                <h2 className="font-semibold text-gray-900 mb-3">Medications</h2>
                {completedForm.medications.none ? (
                  <p className="text-sm text-gray-500">No current medications reported.</p>
                ) : completedForm.medications.list && completedForm.medications.list.length > 0 ? (
                  <div className="space-y-2">
                    {completedForm.medications.list.map((med: any, i: number) => (
                      <div key={i} className="flex items-start gap-3 text-sm border-b pb-2 last:border-0">
                        <div className="flex-1">
                          <span className="font-medium text-gray-800">{med.name || 'Unknown'}</span>
                          {med.dosage && <span className="text-gray-500 ml-2">{med.dosage}</span>}
                        </div>
                        {med.prescriber && <span className="text-gray-400 text-xs">Rx: {med.prescriber}</span>}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">No medication details provided.</p>
                )}
              </div>
            )}

            {/* Medical History & Prior Therapy — side by side */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {completedForm.medical_history && (
                <div className="bg-white border rounded-lg p-5 shadow-sm">
                  <h2 className="font-semibold text-gray-900 mb-3">Medical History</h2>
                  <div className="space-y-2 text-sm">
                    {completedForm.medical_history.conditions && (
                      <div>
                        <span className="text-gray-500">Current Conditions:</span>
                        <p className="text-gray-800 mt-0.5">{completedForm.medical_history.conditions}</p>
                      </div>
                    )}
                    {completedForm.medical_history.surgeries && (
                      <div>
                        <span className="text-gray-500">Past Surgeries:</span>
                        <p className="text-gray-800 mt-0.5">{completedForm.medical_history.surgeries}</p>
                      </div>
                    )}
                    {completedForm.medical_history.allergies && (
                      <div>
                        <span className="text-gray-500">Allergies:</span>
                        <p className="text-gray-800 mt-0.5">{completedForm.medical_history.allergies}</p>
                      </div>
                    )}
                    {completedForm.medical_history.pcp_name && (
                      <InfoRow label="Primary Care Provider" value={completedForm.medical_history.pcp_name} />
                    )}
                    {completedForm.medical_history.pcp_phone && (
                      <InfoRow label="PCP Phone" value={completedForm.medical_history.pcp_phone} />
                    )}
                  </div>
                </div>
              )}

              {completedForm.prior_therapy && (
                <div className="bg-white border rounded-lg p-5 shadow-sm">
                  <h2 className="font-semibold text-gray-900 mb-3">Prior Therapy</h2>
                  <div className="space-y-2 text-sm">
                    <InfoRow label="Previous Therapy" value={completedForm.prior_therapy.has_prior ? 'Yes' : 'No'} />
                    {completedForm.prior_therapy.details && (
                      <div>
                        <span className="text-gray-500">Details:</span>
                        <p className="text-gray-800 mt-0.5">{completedForm.prior_therapy.details}</p>
                      </div>
                    )}
                    {completedForm.prior_therapy.what_helped && (
                      <div>
                        <span className="text-gray-500">What Helped:</span>
                        <p className="text-gray-800 mt-0.5">{completedForm.prior_therapy.what_helped}</p>
                      </div>
                    )}
                    {completedForm.prior_therapy.what_didnt_help && (
                      <div>
                        <span className="text-gray-500">What Didn&apos;t Help:</span>
                        <p className="text-gray-800 mt-0.5">{completedForm.prior_therapy.what_didnt_help}</p>
                      </div>
                    )}
                    {completedForm.prior_therapy.hospitalization && (
                      <div className="bg-amber-50 border border-amber-200 rounded p-2 mt-1">
                        <span className="text-amber-800 font-medium">Hospitalization History: </span>
                        <span className="text-amber-700">{completedForm.prior_therapy.hospitalization_details || 'Yes'}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Substance Use & Family History — side by side */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {completedForm.substance_use && (
                <div className="bg-white border rounded-lg p-5 shadow-sm">
                  <h2 className="font-semibold text-gray-900 mb-3">Substance Use</h2>
                  <div className="divide-y text-sm">
                    {completedForm.substance_use.alcohol && (
                      <InfoRow label="Alcohol" value={completedForm.substance_use.alcohol} />
                    )}
                    {completedForm.substance_use.tobacco && (
                      <InfoRow label="Tobacco" value={completedForm.substance_use.tobacco} />
                    )}
                    {completedForm.substance_use.cannabis && (
                      <InfoRow label="Cannabis" value={completedForm.substance_use.cannabis} />
                    )}
                    {completedForm.substance_use.other_substances && (
                      <div className="py-1.5">
                        <span className="text-gray-500">Other Substances:</span>
                        <p className="text-gray-800 mt-0.5">{completedForm.substance_use.other_substances}</p>
                      </div>
                    )}
                    {completedForm.substance_use.concerns && (
                      <div className="py-1.5">
                        <span className="text-gray-500">Concerns:</span>
                        <p className="text-gray-800 mt-0.5">{completedForm.substance_use.concerns}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {completedForm.family_history && (
                <div className="bg-white border rounded-lg p-5 shadow-sm">
                  <h2 className="font-semibold text-gray-900 mb-3">Family Mental Health History</h2>
                  <div className="space-y-2 text-sm">
                    {completedForm.family_history.conditions && completedForm.family_history.conditions.length > 0 && (
                      <div>
                        <span className="text-gray-500">Conditions in Family:</span>
                        <div className="flex flex-wrap gap-1.5 mt-1">
                          {completedForm.family_history.conditions.map((c: string, i: number) => (
                            <span key={i} className="bg-gray-100 text-gray-700 px-2 py-0.5 rounded text-xs">{c}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    {completedForm.family_history.details && (
                      <div>
                        <span className="text-gray-500">Additional Details:</span>
                        <p className="text-gray-800 mt-0.5">{completedForm.family_history.details}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })()}

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

      {/* Tasks / Messages */}
      {tasks && tasks.length > 0 && (
        <div className="bg-white border rounded-lg p-5 shadow-sm">
          <h2 className="font-semibold text-gray-900 mb-3">
            Messages & Tasks ({tasks.length})
          </h2>
          <div className="space-y-3">
            {tasks.map((task) => (
              <div key={task.id} className="border-b pb-3 last:border-0">
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{task.title}</span>
                    <span
                      className={`text-xs px-1.5 py-0.5 rounded ${
                        task.status === "completed"
                          ? "bg-green-100 text-green-800"
                          : "bg-yellow-100 text-yellow-800"
                      }`}
                    >
                      {task.status}
                    </span>
                    {task.source && (
                      <span className="text-xs text-gray-400">
                        via {task.source}
                      </span>
                    )}
                  </div>
                  <span className="text-gray-400 text-xs">
                    {formatDate(task.created_at)}
                  </span>
                </div>
                {task.description && (
                  <p className="text-sm text-gray-600 mt-1">
                    {task.description}
                  </p>
                )}
              </div>
            ))}
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
                    {(call.new_patient ||
                      call.call_type === "new_patient") && (
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
                  <p className="text-sm text-gray-600 mt-1">
                    {call.summary}
                  </p>
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
