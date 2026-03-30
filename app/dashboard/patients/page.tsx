"use client";
// app/dashboard/patients/page.tsx
// Harbor -- Patient Hub List View

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";

const supabase = createClient();

type Patient = {
  key: string;
  patient_name: string | null;
  patient_email: string | null;
  patient_phone: string | null;
  patient_dob: string | null;
  intake_count: number;
  last_seen: string | null;
  latest_phq9_score: number | null;
  latest_phq9_severity: string | null;
  latest_gad7_score: number | null;
  latest_gad7_severity: string | null;
  phq9_history: { date: string; score: number }[];
  gad7_history: { date: string; score: number }[];
};

async function getAuthToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

async function apiFetch(url: string, options?: RequestInit) {
  const token = await getAuthToken();
  return fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options?.headers ?? {}),
    },
  });
}

const SEVERITY_COLORS: Record<string, string> = {
  Minimal: "bg-green-100 text-green-800",
  Mild: "bg-yellow-100 text-yellow-800",
  Moderate: "bg-orange-100 text-orange-800",
  "Moderately Severe": "bg-red-100 text-red-800",
  Severe: "bg-red-200 text-red-900",
};

function SeverityBadge({ score, severity, label }: { score: number | null; severity: string | null; label: string }) {
  if (score === null || severity === null) return <span className="text-gray-400 text-xs">--</span>;
  return (
    <div>
      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${SEVERITY_COLORS[severity] ?? "bg-gray-100 text-gray-700"}`}>{severity}</span>
      <span className="ml-1.5 text-xs text-gray-500">{label}: {score}</span>
    </div>
  );
}

function Sparkline({ data, color, max = 27 }: { data: { date: string; score: number }[]; color: string; max?: number }) {
  if (data.length < 2) return null;
  const w = 64, h = 24;
  const pts = data.map((d, i) => `${(i / (data.length - 1)) * w},${h - (d.score / max) * h}`);
  return (
    <svg width={w} height={h} className="inline-block">
      <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const EHR_FORMATS = [
  { value: "harbor", label: "Harbor (full data)" },
  { value: "simplepractice", label: "SimplePractice" },
  { value: "therapynotes", label: "TherapyNotes" },
  { value: "jane", label: "Jane App" },
];

export default function PatientsPage() {
  const router = useRouter();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [exportFormat, setExportFormat] = useState("harbor");
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const fetchPatients = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set("search", debouncedSearch);
      const res = await apiFetch(`/api/patients?${params.toString()}`);
      if (res.status === 401) { router.push("/login"); return; }
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to load");
      setPatients(json.patients ?? []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load patients");
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, router]);

  useEffect(() => { fetchPatients(); }, [fetchPatients]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const token = await getAuthToken();
      const res = await fetch(`/api/patients/export?format=${exportFormat}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const cd = res.headers.get("content-disposition") ?? "";
      const match = cd.match(/filename="([^"]+)"/);
      a.download = match ? match[1] : `harbor-patients-${exportFormat}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Export error:", err);
    } finally {
      setExporting(false);
    }
  };

  const elevated = patients.filter((p) =>
    (p.latest_phq9_score !== null && p.latest_phq9_score >= 10) ||
    (p.latest_gad7_score !== null && p.latest_gad7_score >= 10)
  ).length;

  const avgIntakes = patients.length > 0
    ? Math.round(patients.reduce((sum, p) => sum + p.intake_count, 0) / patients.length)
    : null;

  function formatDate(iso: string | null) {
    if (!iso) return "--";
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  // FIX: Use browser-compatible base64url encoding instead of Node.js Buffer
  function patientId(key: string) {
    return btoa(key).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function ageFromDob(dob: string | null) {
    if (!dob) return null;
    const age = Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 24 * 60 * 60 * 1000));
    return isNaN(age) ? null : age;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Patient Hub</h1>
            <p className="text-sm text-gray-500 mt-0.5">Unified patient profiles with outcome tracking</p>
          </div>
          <div className="flex items-center gap-3">
            <a href="/dashboard/intake" className="text-sm text-gray-500 hover:text-teal-600 transition-colors">Intake</a>
            <a href="/dashboard/appointments" className="text-sm text-gray-500 hover:text-teal-600 transition-colors">Appointments</a>
            <a href="/dashboard/settings" className="text-sm text-gray-500 hover:text-teal-600 transition-colors">Settings</a>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Total Patients", value: patients.length, sub: "unique patients", color: "text-gray-900" },
            { label: "Elevated Scores", value: elevated, sub: "PHQ-9 >=10 or GAD-7 >=10", color: elevated > 0 ? "text-red-600" : "text-green-600" },
            { label: "Avg Intakes", value: avgIntakes !== null ? avgIntakes : "--", sub: "per patient", color: "text-teal-600" },
            { label: "Search Results", value: patients.length, sub: debouncedSearch ? `for "${debouncedSearch}"` : "showing all", color: "text-gray-600" },
          ].map((s) => (
            <div key={s.label} className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm">
              <p className="text-sm text-gray-500">{s.label}</p>
              <p className={`text-3xl font-bold mt-1 ${s.color}`}>{s.value}</p>
              <p className="text-xs text-gray-400 mt-0.5">{s.sub}</p>
            </div>
          ))}
        </div>

        <div className="flex gap-3 flex-wrap">
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name, email, or phone..." className="flex-1 min-w-48 px-4 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-500" />
          <div className="flex items-center gap-2">
            <select value={exportFormat} onChange={(e) => setExportFormat(e.target.value)} className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-500 text-gray-700">
              {EHR_FORMATS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
            <button onClick={handleExport} disabled={exporting || patients.length === 0} className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
              {exporting ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <span>{"\u{2193}"}</span>}
              Export CSV
            </button>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="w-8 h-8 border-4 border-teal-200 border-t-teal-600 rounded-full animate-spin" />
            </div>
          ) : error ? (
            <div className="p-8 text-center">
              <p className="text-red-600 mb-3">{error}</p>
              <button onClick={fetchPatients} className="px-4 py-2 text-sm bg-teal-600 text-white rounded-lg hover:bg-teal-700">Retry</button>
            </div>
          ) : patients.length === 0 ? (
            <div className="p-12 text-center text-gray-400">
              <p className="text-4xl mb-3">{"\u{1F464}"}</p>
              <p className="font-medium text-gray-600">No patients found</p>
              <p className="text-sm mt-1">{debouncedSearch ? "Try a different search term" : "Patients will appear here once they complete an intake form"}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Patient</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">PHQ-9</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">GAD-7</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Trend</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Intakes</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Last Seen</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {patients.map((p) => {
                    const age = ageFromDob(p.patient_dob);
                    return (
                      <tr key={p.key} onClick={() => router.push(`/dashboard/patients/${patientId(p.key)}`)} className="hover:bg-teal-50/40 transition-colors cursor-pointer">
                        <td className="px-4 py-3">
                          <p className="font-medium text-gray-900">{p.patient_name ?? "--"}</p>
                          <p className="text-xs text-gray-400 mt-0.5">{age !== null ? `Age ${age}  |  ` : ""}{p.patient_email ?? p.patient_phone ?? ""}</p>
                        </td>
                        <td className="px-4 py-3"><SeverityBadge score={p.latest_phq9_score} severity={p.latest_phq9_severity} label="PHQ" /></td>
                        <td className="px-4 py-3"><SeverityBadge score={p.latest_gad7_score} severity={p.latest_gad7_severity} label="GAD" /></td>
                        <td className="px-4 py-3">
                          <div className="flex gap-2 items-center">
                            <Sparkline data={p.phq9_history} color="#f97316" max={27} />
                            <Sparkline data={p.gad7_history} color="#8b5cf6" max={21} />
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-teal-50 text-teal-700">{p.intake_count}</span>
                        </td>
                        <td className="px-4 py-3 text-gray-600 text-sm">{formatDate(p.last_seen)}</td>
                        <td className="px-4 py-3 text-right"><span className="text-teal-600 text-xs font-medium">View -></span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
