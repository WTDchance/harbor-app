"use client";

// Wave 21: supabase-browser is now a no-op stub. Auth via Cognito cookies.
import { createClient } from '@/lib/supabase-browser'
const supabase = createClient()
// app/dashboard/patients/page.tsx
// Harbor -- Patient Hub List View
// FIX: Uses patient UUID for detail links (not base64-encoded email/phone).
// Shows intake_status badge so practitioners see who needs intake forms.

import { useState, useEffect, useCallback, useMemo, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import PatientFlagChips from "@/components/ehr/PatientFlagChips";
import SavedViewsSidebar, { FilterChipBar, emptyFilter, type SavedView } from "@/components/ehr/SavedViewsSidebar";
import type { FilterNode } from "@/lib/ehr/patient-flags";


type Patient = {
  key: string; // patient UUID
  active_flags?: string[];
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
  const [showCreate, setShowCreate] = useState(false);
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

      // Wave 49 -- side fetch for active flags so we can render chips on
      // the legacy list rows. Best-effort; failures fall through silently.
      try {
        const fr = await fetch('/api/ehr/patients-search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filter, sort: { field: 'last_name', direction: 'asc' }, limit: 500 }),
        });
        if (fr.ok) {
          const fj = await fr.json();
          const map: Record<string, string[]> = {};
          for (const p of (fj.patients || []) as { id: string; active_flags?: string[] }[]) {
            map[p.id] = Array.isArray(p.active_flags) ? p.active_flags : [];
          }
          setFlagsByPatient(map);
        }
      } catch { /* ignore */ }
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

  // ── W50 D1: wire saved views + filter chips + flag chips ──────────────
  const [filterOpen, setFilterOpen] = useState(false);
  const [filter, setFilter] = useState<FilterNode>(emptyFilter());
  const [activeView, setActiveView] = useState<SavedView | null>(null);
  const [filteredPatients, setFilteredPatients] = useState<Patient[] | null>(null);
  const [flagsByPatient, setFlagsByPatient] = useState<Record<string, string[]>>({});

  const filterIsActive = useMemo(() => {
    if (activeView) return true;
    if (filter && 'predicates' in filter && Array.isArray(filter.predicates) && filter.predicates.length > 0) return true;
    return false;
  }, [filter, activeView]);

  // Fetch flags for the loaded patient set so chips render in each row.
  useEffect(() => {
    const list = filteredPatients ?? patients;
    if (!list || list.length === 0) { setFlagsByPatient({}); return; }
    const ids = list.map(p => p.key).filter(Boolean);
    if (ids.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/ehr/patients/bulk-flags', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ patient_ids: ids }),
        });
        if (!res.ok) return;
        const j = await res.json();
        if (!cancelled) setFlagsByPatient(j.flags || {});
      } catch { /* silent — chips just don't render */ }
    })();
    return () => { cancelled = true };
  }, [patients, filteredPatients]);

  // When filters change, re-run the patients-search endpoint.
  useEffect(() => {
    if (!filterIsActive) { setFilteredPatients(null); return; }
    const effectiveFilter = activeView?.filter ?? filter;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/ehr/patients-search', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ filter: effectiveFilter, sort: { field: 'last_name', direction: 'asc' }, limit: 200 }),
        });
        if (!res.ok) return;
        const j = await res.json();
        if (cancelled) return;
        const mapped: Patient[] = (j.patients ?? []).map((p: any) => ({
          key: p.id,
          patient_name: [p.first_name, p.last_name].filter(Boolean).join(' ') || null,
          patient_email: p.email ?? null,
          patient_phone: p.phone ?? null,
          patient_dob: null,
          intake_status: 'none',
          intake_count: 0,
          last_seen: p.last_contact_at ?? null,
          latest_phq9_score: null,
          latest_phq9_severity: null,
          latest_gad7_score: null,
          latest_gad7_severity: null,
          created_at: p.created_at ?? '',
          active_flags: p.active_flags ?? [],
        }));
        setFilteredPatients(mapped);
      } catch { /* keep prior */ }
    })();
    return () => { cancelled = true };
  }, [filter, activeView, filterIsActive]);

  return (
    <div className="flex max-w-7xl mx-auto">
      <SavedViewsSidebar
        selectedId={activeView?.id ?? null}
        onSelect={(v) => { setActiveView(v); if (v) setFilter(v.filter as FilterNode || emptyFilter()); }}
        currentFilter={filter}
        currentSort={{ field: 'last_name', direction: 'asc' }}
      />
      <div className="flex-1 p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Patients</h1>
          <p className="text-sm text-gray-500">{total} patient{total !== 1 ? "s" : ""}{filterIsActive ? ` · filtered (${(filteredPatients ?? []).length})` : ''}</p>
        </div>
        <div className="flex items-center gap-2">
        <button
          onClick={() => setFilterOpen(o => !o)}
          className="px-3 py-2 border border-gray-300 hover:bg-gray-50 text-gray-700 text-sm font-medium rounded-lg"
        >
          {filterOpen ? 'Hide filters' : 'Filters'}
        </button>
        <button
          onClick={() => setShowCreate(true)}
          className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium rounded-lg shadow-sm"
        >
          + New patient
        </button>
        </div>
      </div>

      {filterOpen && (
        <FilterChipBar value={filter} onChange={(n) => { setActiveView(null); setFilter(n); }} />
      )}

      {showCreate && (
        <NewPatientModal
          onClose={() => setShowCreate(false)}
          onCreated={(id) => {
            setShowCreate(false);
            router.push(`/dashboard/patients/${id}`);
          }}
        />
      )}

      {/* Wave 49: chip-based filter bar. */}
      <FilterChipBar value={filter} onChange={setFilter} />

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
          {sortPatients(filteredPatients ?? patients, sortBy).map((patient) => (
            <div
              key={patient.key}
              onClick={() => router.push(`/dashboard/patients/${patient.key}`)}
              className="flex items-center justify-between px-5 py-4 hover:bg-gray-50 cursor-pointer transition"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 flex-wrap">
                  <h3 className="font-medium text-gray-900 truncate">
                    {patient.patient_name || "Unknown"}
                  </h3>
                  <IntakeStatusBadge status={patient.intake_status} />
                  <PatientFlagChips flags={patient.active_flags ?? flagsByPatient[patient.key] ?? []} max={3} size="xs" />
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
    </div>
  );
}

function NewPatientModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [form, setForm] = useState({
    first_name: "",
    last_name: "",
    phone: "",
    email: "",
    date_of_birth: "",
    insurance_provider: "",
    insurance_member_id: "",
    insurance_group_number: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function update<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.first_name.trim() || !form.last_name.trim() || !form.phone.trim()) {
      setError("First name, last name, and phone are required.");
      return;
    }
    setSubmitting(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        setError("Session expired. Please log in again.");
        setSubmitting(false);
        return;
      }
      const res = await fetch("/api/patients", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(form),
      });
      const body = await res.json().catch(() => null);
      if (res.status === 409 && body?.existing_patient_id) {
        // Patient with this phone already exists — jump to their profile.
        onCreated(body.existing_patient_id);
        return;
      }
      if (!res.ok) {
        setError(body?.error || `Failed to create patient (${res.status})`);
        setSubmitting(false);
        return;
      }
      if (body?.patient?.id) {
        onCreated(body.patient.id);
      }
    } catch (err: any) {
      setError(err?.message || "Request failed");
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-semibold text-gray-900">New patient</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <LabeledInput
              label="First name *"
              value={form.first_name}
              onChange={(v) => update("first_name", v)}
              autoFocus
            />
            <LabeledInput
              label="Last name *"
              value={form.last_name}
              onChange={(v) => update("last_name", v)}
            />
          </div>
          <LabeledInput
            label="Phone *"
            type="tel"
            value={form.phone}
            onChange={(v) => update("phone", v)}
            placeholder="+1 555 555 5555"
          />
          <div className="grid grid-cols-2 gap-3">
            <LabeledInput
              label="Email"
              type="email"
              value={form.email}
              onChange={(v) => update("email", v)}
            />
            <LabeledInput
              label="Date of birth"
              type="date"
              value={form.date_of_birth}
              onChange={(v) => update("date_of_birth", v)}
            />
          </div>
          <div className="pt-2 border-t">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
              Insurance (optional)
            </div>
            <div className="space-y-3">
              <LabeledInput
                label="Carrier"
                value={form.insurance_provider}
                onChange={(v) => update("insurance_provider", v)}
                placeholder="e.g. Oregon Medicaid"
              />
              <div className="grid grid-cols-2 gap-3">
                <LabeledInput
                  label="Member ID"
                  value={form.insurance_member_id}
                  onChange={(v) => update("insurance_member_id", v)}
                />
                <LabeledInput
                  label="Group number"
                  value={form.insurance_group_number}
                  onChange={(v) => update("insurance_group_number", v)}
                />
              </div>
            </div>
          </div>

          {error && (
            <div className="text-sm text-red-700 bg-red-50 rounded-md p-3">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 disabled:opacity-50"
            >
              {submitting ? "Creating…" : "Create patient"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-gray-700 mb-1">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
      />
    </label>
  );
}
