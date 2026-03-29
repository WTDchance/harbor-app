"use client";
// app/dashboard/intake/page.tsx
// Harbor — Intake Submissions Dashboard
// Shows all completed patient intake forms for the practice

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";

const supabase = createClient();

// ─── Types ────────────────────────────────────────────────────────────────────

type Severity = "Minimal" | "Mild" | "Moderate" | "Moderately Severe" | "Severe";

type Submission = {
  id: string;
  status: string;
  patient_name: string | null;
  patient_phone: string | null;
  patient_email: string | null;
  patient_dob: string | null;
  phq9_score: number | null;
  phq9_severity: Severity | null;
  gad7_score: number | null;
  gad7_severity: Severity | null;
  completed_at: string | null;
  created_at: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getAuthToken(): Promise<string | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
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

// ─── Severity badge ───────────────────────────────────────────────────────────

const SEVERITY_COLORS: Record<string, string> = {
  Minimal: "bg-green-100 text-green-800",
  Mild: "bg-yellow-100 text-yellow-800",
  Moderate: "bg-orange-100 text-orange-800",
  "Moderately Severe": "bg-red-100 text-red-800",
  Severe: "bg-red-200 text-red-900",
};

function SeverityBadge({
  score,
  severity,
  label,
}: {
  score: number | null;
  severity: string | null;
  label: string;
}) {
  if (score === null || severity === null) {
    return <span className="text-gray-400 text-xs">—</span>;
  }
  return (
    <div>
      <span
        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
          SEVERITY_COLORS[severity] ?? "bg-gray-100 text-gray-700"
        }`}
      >
        {severity}
      </span>
      <span className="ml-1.5 text-xs text-gray-500">
        {label}: {score}
      </span>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function IntakeDashboardPage() {
  const router = useRouter();
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"completed" | "pending" | "all">("completed");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const limit = 25;

  const fetchSubmissions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("status", statusFilter);
      params.set("page", String(page));
      params.set("limit", String(limit));
      if (search) params.set("search", search);
      if (fromDate) params.set("from", fromDate);
      if (toDate) params.set("to", toDate);

      const res = await apiFetch(`/api/intake/submissions?${params.toString()}`);
      if (res.status === 401) {
        router.push("/login");
        return;
      }
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to load");
      setSubmissions(json.submissions ?? []);
      setTotal(json.pagination?.total ?? 0);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load intake submissions");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, page, search, fromDate, toDate, router]);

  useEffect(() => {
    fetchSubmissions();
  }, [fetchSubmissions]);

  useEffect(() => {
    setPage(1);
  }, [statusFilter, search, fromDate, toDate]);

  const completed = submissions.filter((s) => s.status === "completed");
  const avgPhq9 =
    completed.length > 0 && completed.some((s) => s.phq9_score !== null)
      ? Math.round(
          completed.reduce((sum, s) => sum + (s.phq9_score ?? 0), 0) /
            completed.filter((s) => s.phq9_score !== null).length
        )
      : null;
  const elevated = completed.filter(
    (s) =>
      (s.phq9_score !== null && s.phq9_score >= 10) ||
      (s.gad7_score !== null && s.gad7_score >= 10)
  ).length;

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Intake Submissions</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Patient intake forms and clinical screening results
            </p>
          </div>
          <div className="flex items-center gap-3">
            <a href="/dashboard/appointments" className="text-sm text-gray-500 hover:text-teal-600 transition-colors">
              ← Appointments
            </a>
            <a href="/dashboard/settings" className="text-sm text-gray-500 hover:text-teal-600 transition-colors">
              Settings
            </a>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Total Submitted", value: total, sub: "all time", color: "text-gray-900" },
            { label: "On This Page", value: submissions.length, sub: `of ${total}`, color: "text-teal-600" },
            {
              label: "Avg PHQ-9",
              value: avgPhq9 !== null ? avgPhq9 : "—",
              sub: "depression screen",
              color: avgPhq9 !== null && avgPhq9 >= 10 ? "text-orange-600" : "text-gray-900",
            },
            {
              label: "Elevated Scores",
              value: elevated,
              sub: "PHQ-9 ≥10 or GAD-7 ≥10",
              color: elevated > 0 ? "text-red-600" : "text-green-600",
            },
          ].map((s) => (
            <div key={s.label} className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm">
              <p className="text-sm text-gray-500">{s.label}</p>
              <p className={`text-3xl font-bold mt-1 ${s.color}`}>{s.value}</p>
              <p className="text-xs text-gray-400 mt-0.5">{s.sub}</p>
            </div>
          ))}
        </div>

        <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by patient name…"
            className="flex-1 min-w-48 px-4 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
          <div className="flex items-center gap-2">
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-500" />
            <span className="text-gray-400 text-sm">to</span>
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-500" />
          </div>
          <div className="flex gap-2">
            {(["completed", "pending", "all"] as const).map((s) => (
              <button key={s} onClick={() => setStatusFilter(s)}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  statusFilter === s ? "bg-teal-600 text-white" : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"
                }`}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
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
              <button onClick={fetchSubmissions} className="px-4 py-2 text-sm bg-teal-600 text-white rounded-lg hover:bg-teal-700">Retry</button>
            </div>
          ) : submissions.length === 0 ? (
            <div className="p-12 text-center text-gray-400">
              <p className="text-4xl mb-3">📋</p>
              <p className="font-medium text-gray-600">No intake submissions found</p>
              <p className="text-sm mt-1">
                {search || fromDate || toDate ? "Try adjusting your filters" :
                  statusFilter === "completed" ? "Completed submissions will appear here once patients fill out their intake forms" :
                  "No submissions yet"}
              </p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Patient</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">PHQ-9</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">GAD-7</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Submitted</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {submissions.map((sub) => (
                      <tr key={sub.id} onClick={() => router.push(`/dashboard/intake/${sub.id}`)}
                        className="hover:bg-teal-50/40 transition-colors cursor-pointer">
                        <td className="px-4 py-3">
                          <p className="font-medium text-gray-900">{sub.patient_name ?? "—"}</p>
                          <p className="text-xs text-gray-400 mt-0.5">{sub.patient_phone ?? sub.patient_email ?? ""}</p>
                        </td>
                        <td className="px-4 py-3">
                          <SeverityBadge score={sub.phq9_score} severity={sub.phq9_severity} label="PHQ" />
                        </td>
                        <td className="px-4 py-3">
                          <SeverityBadge score={sub.gad7_score} severity={sub.gad7_severity} label="GAD" />
                        </td>
                        <td className="px-4 py-3 text-gray-600">
                          {sub.completed_at
                            ? new Date(sub.completed_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                            : "—"}
                          {sub.completed_at && (
                            <p className="text-xs text-gray-400 mt-0.5">
                              {new Date(sub.completed_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            sub.status === "completed" ? "bg-green-100 text-green-800" : "bg-yellow-100 text-yellow-800"
                          }`}>
                            {sub.status.charAt(0).toUpperCase() + sub.status.slice(1)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="text-teal-600 text-xs font-medium">View →</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 bg-gray-50">
                  <p className="text-sm text-gray-500">
                    Showing {(page - 1) * limit + 1}–{Math.min(page * limit, total)} of {total}
                  </p>
                  <div className="flex gap-2">
                    <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
                      className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                      ← Prev
                    </button>
                    <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                      className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                      Next →
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
