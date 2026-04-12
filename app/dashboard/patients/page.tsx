"use client";
// app/dashboard/patients/page.tsx
// Harbor -- Patient Hub List View
// FIX: Uses patient UUID for detail links (not base64-encoded email/phone).
// Shows intake_status badge so practitioners see who needs intake forms.

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";

const supabase = createClient();

type Patient = {
  key: string; // patient UUID
  patient_name: string | null;
  patient_email: string | null;
  patient_phone: string | null;
  patient_dob: string | null;
  intake_status: string; // "completed" | "pending" | "sent" | "opened" | "none"
  intake_count: number;
  last_seen: string | null;
  latest_phq9_score: number | null;
  latest_phq9_severity: string | null;
  latest_gad7_score: number | null;
  latest_gad7_severity: string | null;
  created_at: string;
};

function IntakeStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    completed: "bg-green-100 text-green-800",
    opened: "bg-blue-100 text-blue-800",
    sent: "bg-yellow-100 text-yellow-800",
    pending: "bg-yellow-100 text-yellow-800",
    none: "bg-gray-100 text-gray-500",
  };
  const labels: Record<string, string> = {
    completed: "Intake Complete",
    opened: "Intake Opened",
    sent: "Intake Sent",
    pending: "Intake Pending",
    none: "No Intake",
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
        styles[status] || styles.none
      }`}
    >
      {labels[status] || status}
    </span>
  );
}

function SeverityBadge({ label, score, severity }: { label: string; score: number | null; severity: string | null }) {
  if (score === null) return null;
  const colors: Record<string, string> = {
    minimal: "text-green-700",
    mild: "text-yellow-700",
    moderate: "text-orange-700",
    "moderately severe": "text-red-600",
    severe: "text-red-800",
  };
  return (
    <span className={`text-xs ${colors[severity?.toLowerCase() || ""] || "text-gray-600"}`}>
      {label}: <strong>{score}</strong>
    </span>
  );
}

type SortOption = "name-asc" | "name-desc" | "newest" | "oldest" | "last-seen";

const SORT_LABELS: Record<SortOption, string> = {
  "name-asc": "Name A–Z",
  "name-desc": "Name Z–A",
  "newest": "Newest First",
  "oldest": "Oldest First",
  "last-seen": "Last Seen",
};

function sortPatients(list: Patient[], sort: SortOption): Patient[] {
  return [...list].sort((a, b) => {
    switch (sort) {
      case "name-asc": {
        const na = (a.patient_name || "").toLowerCase();
        const nb = (b.patient_name || "").toLowerCase();
        if (!a.patient_name) return 1;
        if (!b.patient_name) return -1;
        return na.localeCompare(nb);
      }
      case "name-desc": {
        const na = (a.patient_name || "").toLowerCase();
        const nb = (b.patient_name || "").toLowerCase();
        if (!a.patient_name) return 1;
        if (!b.patient_name) return -1;
        return nb.localeCompare(na);
      }
      case "newest":
        return (b.created_at || "").localeCompare(a.created_at || "");
      case "oldest":
        return (a.created_at || "").localeCompare(b.created_at || "");
      case "last-seen":
      default: {
        if (!a.last_seen && !b.last_seen) return 0;
        if (!a.last_seen) return 1;
        if (!b.last_seen) return -1;
        return b.last_seen.localeCompare(a.last_seen);
      }
    }
  });
}

export default function PatientsPage() {
  const router = useRouter();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("name-asc");

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const fetchPatients = useCallback(async () => {
    setLoading(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        router.push("/login");
        return;
      }

      const params = new URLSearchParams();
      if (debouncedSearch) params.set("search", debouncedSearch);

      const res = await fetch(`/api/patients?${params.toString()}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (!res.ok) {
        console.error("Failed to fetch patients:", res.status);
        return;
      }

      const json = await res.json();
      setPatients(json.patients || []);
      setTotal(json.total || 0);
    } catch (e) {
      console.error("Error fetching patients:", e);
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, router]);

  useEffect(() => {
    fetchPatients();
  }, [fetchPatients]);

  // Auto-refresh every 2 minutes
  useEffect(() => {
    const interval = setInterval(fetchPatients, 120000);
    return () => clearInterval(interval);
  }, [fetchPatients]);

  return (
    <div className="max-w-5xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Patients</h1>
          <p className="text-sm text-gray-500">{total} patient{total !== 1 ? "s" : ""}</p>
        </div>
      </div>

      {/* Search + Sort */}
      <div className="flex gap-3 mb-4">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, email, or phone..."
          className="flex-1 border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
        />
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortOption)}
          className="border rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
        >
          {Object.entries(SORT_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {/* Patients list */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600" />
        </div>
      ) : patients.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          {debouncedSearch
            ? "No patients match your search."
            : "No patients yet. They will appear here after their first call."}
        </div>
      ) : (
        <div className="bg-white border rounded-lg shadow-sm divide-y">
          {sortPatients(patients, sortBy).map((patient) => (
            <div
              key={patient.key}
              onClick={() => router.push(`/dashboard/patients/${patient.key}`)}
              className="flex items-center justify-between px-5 py-4 hover:bg-gray-50 cursor-pointer transition"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3">
                  <h3 className="font-medium text-gray-900 truncate">
                    {patient.patient_name || "Unknown"}
                  </h3>
                  <IntakeStatusBadge status={patient.intake_status} />
                </div>
                <div className="flex items-center gap-4 mt-1 text-sm text-gray-500">
                  {patient.patient_phone && (
                    <span>{patient.patient_phone}</span>
                  )}
                  {patient.patient_email && (
                    <span className="truncate">{patient.patient_email}</span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-4 ml-4 shrink-0">
                {/* Screening scores */}
                <div className="flex flex-col items-end gap-0.5">
                  <SeverityBadge
                    label="PHQ-9"
                    score={patient.latest_phq9_score}
                    severity={patient.latest_phq9_severity}
                  />
                  <SeverityBadge
                    label="GAD-7"
                    score={patient.latest_gad7_score}
                    severity={patient.latest_gad7_severity}
                  />
                </div>

                {/* Last seen */}
                <div className="text-xs text-gray-400 text-right w-20">
                  {patient.last_seen
                    ? new Date(patient.last_seen).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })
                    : ""}
                </div>

                {/* Chevron */}
                <svg
                  className="w-5 h-5 text-gray-300"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
