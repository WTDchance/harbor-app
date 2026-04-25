"use client";
import { useState } from "react";

export type EligibilityStatus =
  | "active"
  | "inactive"
  | "error"
  | "manual_pending"
  | "missing_data"
  | "pending"
  | "unknown";

export interface EligibilityData {
  record_id: string;
  insurance_company: string | null;
  member_id: string | null;
  group_number: string | null;
  subscriber_name: string | null;
  subscriber_dob: string | null;
  relationship_to_subscriber: string | null;
  last_verified_at: string | null;
  last_verification_status: string | null;
  next_verify_due: string | null;
  latest_check: {
    id: string;
    status: EligibilityStatus;
    is_active: boolean | null;
    mental_health_covered: boolean | null;
    copay_amount: number | null;
    coinsurance_percent: number | null;
    deductible_total: number | null;
    deductible_met: number | null;
    session_limit: number | null;
    sessions_used: number | null;
    prior_auth_required: boolean | null;
    plan_name: string | null;
    coverage_start_date: string | null;
    coverage_end_date: string | null;
    payer_id: string | null;
    trigger_source: string | null;
    error_message: string | null;
    checked_at: string;
  } | null;
}

// Per-patient eligibility panel. Reads data already on the patient record and
// offers a "Re-verify now" action that hits /api/insurance/verify and refreshes.
export default function EligibilityPanel({
  eligibility,
  patient,
  onChanged,
}: {
  eligibility: EligibilityData | null;
  patient: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    phone: string | null;
    date_of_birth: string | null;
    insurance_provider: string | null;
    insurance_member_id: string | null;
    insurance_group_number: string | null;
  };
  onChanged?: () => void;
}) {
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const status: EligibilityStatus = eligibility?.latest_check?.status ?? "unknown";
  const check = eligibility?.latest_check ?? null;
  const hasAnyInsurance =
    !!eligibility || !!patient.insurance_provider || !!patient.insurance_member_id;

  async function handleVerify() {
    setError(null);
    setVerifying(true);
    try {
      const patientName = [patient.first_name, patient.last_name]
        .filter(Boolean)
        .join(" ");
      const insuranceCompany =
        eligibility?.insurance_company || patient.insurance_provider;
      if (!insuranceCompany) {
        setError("No insurance carrier on file for this patient.");
        setVerifying(false);
        return;
      }
      const res = await fetch("/api/insurance/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          record_id: eligibility?.record_id,
          patient_id: patient.id,
          patient_name: patientName,
          patient_dob: patient.date_of_birth,
          patient_phone: patient.phone,
          insurance_company: insuranceCompany,
          member_id: eligibility?.member_id || patient.insurance_member_id,
          group_number: eligibility?.group_number || patient.insurance_group_number,
          subscriber_name: eligibility?.subscriber_name,
          subscriber_dob: eligibility?.subscriber_dob,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error || `Verification failed (${res.status})`);
      } else if (onChanged) {
        onChanged();
      }
    } catch (err: any) {
      setError(err?.message || "Request failed");
    } finally {
      setVerifying(false);
    }
  }

  if (!hasAnyInsurance) {
    return (
      <div className="mt-4 pt-4 border-t text-sm text-gray-500">
        No insurance on file. Add via Edit Patient or have them complete the
        intake form.
      </div>
    );
  }

  return (
    <div className="mt-4 pt-4 border-t">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-semibold text-gray-700">Eligibility</div>
        <StatusBadge status={status} />
      </div>

      {check ? (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          {check.plan_name && (
            <Row label="Plan" value={check.plan_name} />
          )}
          {check.copay_amount !== null && (
            <Row label="Copay" value={`$${check.copay_amount.toFixed(2)}`} />
          )}
          {check.coinsurance_percent !== null && (
            <Row
              label="Coinsurance"
              value={`${check.coinsurance_percent}%`}
            />
          )}
          {check.deductible_total !== null && (
            <Row
              label="Deductible"
              value={`$${(check.deductible_met ?? 0).toFixed(0)} / $${check.deductible_total.toFixed(0)}`}
            />
          )}
          {check.session_limit !== null && (
            <Row label="Session limit" value={`${check.session_limit}`} />
          )}
          {check.prior_auth_required && (
            <Row label="Prior auth" value="Required" valueClass="text-amber-700 font-medium" />
          )}
          {check.coverage_end_date && (
            <Row label="Coverage ends" value={formatDate(check.coverage_end_date)} />
          )}
          {check.error_message && status !== "active" && (
            <div className="col-span-2 text-xs text-red-700 bg-red-50 rounded p-2 mt-1">
              {check.error_message}
            </div>
          )}
        </dl>
      ) : (
        <div className="text-sm text-gray-500">
          Never verified. Click below to run a live check.
        </div>
      )}

      <div className="flex items-center justify-between mt-4 text-xs text-gray-500">
        <div>
          Last verified:{" "}
          {eligibility?.last_verified_at
            ? `${formatDateTime(eligibility.last_verified_at)}`
            : "never"}
        </div>
        <button
          onClick={handleVerify}
          disabled={verifying}
          className="px-3 py-1.5 text-xs font-medium rounded-md bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {verifying ? "Verifying…" : "Re-verify now"}
        </button>
      </div>

      {error && (
        <div className="mt-3 text-xs text-red-700 bg-red-50 rounded p-2">
          {error}
        </div>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <>
      <dt className="text-gray-500">{label}</dt>
      <dd className={valueClass || "text-gray-900"}>{value}</dd>
    </>
  );
}

function StatusBadge({ status }: { status: EligibilityStatus }) {
  const map: Record<EligibilityStatus, { label: string; cls: string }> = {
    active:         { label: "Active",        cls: "bg-green-100 text-green-800" },
    inactive:       { label: "Inactive",      cls: "bg-red-100 text-red-800" },
    error:          { label: "Error",         cls: "bg-red-100 text-red-800" },
    missing_data:   { label: "Needs info",    cls: "bg-amber-100 text-amber-800" },
    manual_pending: { label: "Manual",        cls: "bg-amber-100 text-amber-800" },
    pending:        { label: "Pending",       cls: "bg-gray-100 text-gray-700" },
    unknown:        { label: "Unverified",    cls: "bg-gray-100 text-gray-700" },
  };
  const s = map[status] || map.unknown;
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${s.cls}`}>
      {s.label}
    </span>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
