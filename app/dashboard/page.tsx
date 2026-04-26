"use client";
// app/dashboard/page.tsx
// Harbor -- Dashboard Overview
// Summary stats + quick links for today's state of the practice.

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
function stripMd(s: string): string {
  if (!s) return s;
  return s.replace(/\*\*/g, '').replace(/\*/g, '').replace(/^- /gm, '').trim();
}



async function apiFetch(url: string, init?: RequestInit) {
  return fetch(url, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
}

type Stats = {
  totalPatients: number;
  elevatedScores: number;
  pendingIntakes: number;
  todayAppointments: number;
  scheduledAppointments: number;
  recentIntakes: {
    id: string;
    patient_name: string | null;
    phq9_severity: string | null;
    gad7_severity: string | null;
    completed_at: string | null;
  }[];
  upcomingAppointments: {
    id: string;
    patient_name: string | null;
    scheduled_at: string;
    appointment_type: string;
    status: string;
  }[];
  totalCalls: number;
  recentCalls: {
    id: string;
    patient_phone: string;
    duration_seconds: number;
    summary: string | null;
    created_at: string;
    crisis_detected: boolean;
  }[];
  crisisAlerts: number;
};

const SEVERITY_COLORS: Record<string, string> = {
  Minimal: "bg-green-100 text-green-700",
  Mild: "bg-yellow-100 text-yellow-700",
  Moderate: "bg-orange-100 text-orange-700",
  "Moderately Severe": "bg-red-100 text-red-700",
  Severe: "bg-red-200 text-red-800",
};

const APPT_STATUS_COLORS: Record<string, string> = {
  scheduled: "bg-blue-100 text-blue-700",
  confirmed: "bg-teal-100 text-teal-700",
  completed: "bg-green-100 text-green-700",
  cancelled: "bg-gray-100 text-gray-500",
  "no-show": "bg-red-100 text-red-700",
};

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatDateShort(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === tomorrow.toDateString()) return "Tomorrow";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(diff / (1000 * 60 * 60));
  if (hours < 1) return "Just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function DashboardHome() {
  const router = useRouter();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [greetingName, setGreetingName] = useState<string>("");

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        // Get greeting name from user record
        const { data: userRecord } = await supabase
          .from("users")
          .select("first_name")
          .eq("id", user.id)
          .single();
        if (userRecord?.first_name) {
          setGreetingName(userRecord.first_name);
        } else {
          // Fall back to practice provider name via server-side resolver
          try {
            const res = await fetch("/api/practice/me");
            if (res.ok) {
              const data = await res.json();
              if (data.practice?.provider_name) {
                const firstName = data.practice.provider_name.split(" ")[0];
                setGreetingName(firstName);
              }
            }
          } catch {}
          // Final fallback: email prefix
          if (!greetingName && user.email) {
            const fallback = user.email.split("@")[0];
            setGreetingName(fallback.charAt(0).toUpperCase() + fallback.slice(1));
          }
        }
      }
    })();

    loadStats(true);
  }, []);

  // Auto-refresh call logs every 2 minutes
  useEffect(() => {
    const interval = setInterval(() => {
      loadStats()
    }, 120000)
    return () => clearInterval(interval)
  }, [])

  async function loadStats(isInitial = false) {
    if (isInitial) setLoading(true);
    try {
      const today = new Date();
      const startOfDay = new Date(today.setHours(0, 0, 0, 0)).toISOString();
      const endOfDay = new Date(today.setHours(23, 59, 59, 999)).toISOString();

      const [patientsRes, intakeRes, appointmentsRes, pendingRes] = await Promise.all([
        apiFetch("/api/patients"),
        apiFetch("/api/intake/submissions?limit=5&status=completed"),
        apiFetch(`/api/appointments?from=${startOfDay}&to=${endOfDay}&limit=10`),
        apiFetch("/api/intake/submissions?limit=1&status=pending"),
      ]);

      const [patientsData, intakeData, appointmentsData, pendingData] = await Promise.all([
        patientsRes.ok ? patientsRes.json() : { patients: [], total: 0 },
        intakeRes.ok ? intakeRes.json() : { submissions: [], pagination: { total: 0 } },
        appointmentsRes.ok ? appointmentsRes.json() : { appointments: [], pagination: { total: 0 } },
        pendingRes.ok ? pendingRes.json() : { pagination: { total: 0 } },
      ]);

      if (patientsRes.status === 401) { router.push("/login"); return; }

      // Fetch call stats from server-side API (bypasses RLS)
    let totalCalls = 0;
    let recentCalls: Stats["recentCalls"] = [];
    let crisisAlerts = 0;
    try {
      const callStatsRes = await fetch(`/api/dashboard/calls?mode=stats&from=${startOfDay}&to=${endOfDay}`);
      if (callStatsRes.ok) {
        const callStats = await callStatsRes.json();
        totalCalls = callStats.totalCount || 0;
        recentCalls = callStats.recentCalls || [];
        crisisAlerts = callStats.crisisCount || 0;
      }
    } catch (callErr) {
      console.error('[Dashboard] Failed to fetch call stats:', callErr);
    }

    const patients = patientsData.patients ?? [];
    const elevated = patients.filter(
      (p: { latest_phq9_score: number | null; latest_gad7_score: number | null }) =>
        (p.latest_phq9_score !== null && p.latest_phq9_score >= 10) ||
        (p.latest_gad7_score !== null && p.latest_gad7_score >= 10)
    ).length;
    const appts = appointmentsData.appointments ?? [];
    const todayAppts = appts.filter(
      (a: { scheduled_at: string }) =>
        new Date(a.scheduled_at).toDateString() === new Date().toDateString()
    );

    setStats({
      totalPatients: patientsData.total ?? patients.length,
        elevatedScores: elevated,
        pendingIntakes: pendingData.pagination?.total ?? 0,
        todayAppointments: todayAppts.length,
        scheduledAppointments: appointmentsData.pagination?.total ?? appts.length,
        recentIntakes: (intakeData.submissions ?? []).slice(0, 4),
        upcomingAppointments: appts.slice(0, 5),
        totalCalls,
        recentCalls,
        crisisAlerts,
      });
    } catch (err) {
      console.error("Dashboard load error:", err);
    } finally {
      setLoading(false);
    }
  }

  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <div className="bg-gray-50 min-h-full">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-6 py-5">
        <div className="max-w-6xl mx-auto">
          <h1 className="text-xl font-bold" style={{ color: '#1f375d' }}>
            {greeting}{greetingName ? `, ${greetingName}` : ""}
          </h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {new Date().toLocaleDateString("en-US", {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </p>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-6 space-y-6">
        {/* Stats grid */}
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          {[
            {
              label: "Today's Appointments",
              value: loading ? "--" : stats?.todayAppointments ?? 0,
              sub: "scheduled today",
              color: "text-teal-600",
              href: "/dashboard/appointments",
              bg: "bg-teal-50",
              icon: (
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="text-teal-500">
                  <rect x="2" y="4" width="16" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M7 2v4M13 2v4M2 8h16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              ),
            },
            {
              label: "Total Patients",
              value: loading ? "--" : stats?.totalPatients ?? 0,
              sub: "in your practice",
              color: "text-blue-600",
              href: "/dashboard/patients",
              bg: "bg-blue-50",
              icon: (
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="text-blue-500">
                  <circle cx="10" cy="7" r="3.5" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M3 18c0-3.9 3.1-7 7-7s7 3.1 7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              ),
            },
            {
              label: "Elevated Scores",
              value: loading ? "--" : stats?.elevatedScores ?? 0,
              sub: "PHQ-9 >=10 or GAD-7 >=10",
              color: stats?.elevatedScores ? "text-red-600" : "text-green-600",
              href: "/dashboard/patients",
              bg: stats?.elevatedScores ? "bg-red-50" : "bg-green-50",
              icon: (
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className={stats?.elevatedScores ? "text-red-500" : "text-green-500"}>
                  <path d="M10 3l2 5h5l-4 3 2 5-5-3.5L5 16l2-5-4-3h5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                </svg>
              ),
            },
            {
              label: "Pending Intakes",
              value: loading ? "--" : stats?.pendingIntakes ?? 0,
              sub: "awaiting completion",
              color: stats?.pendingIntakes ? "text-amber-600" : "text-gray-600",
              href: "/dashboard/intake",
              bg: stats?.pendingIntakes ? "bg-amber-50" : "bg-gray-50",
              icon: (
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className={stats?.pendingIntakes ? "text-amber-500" : "text-gray-400"}>
                  <rect x="4" y="2" width="12" height="16" rx="2" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M7 7h6M7 10h6M7 13h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              ),
            },
            {
              label: "Total Calls",
              value: loading ? "--" : stats?.totalCalls ?? 0,
              sub: "handled by Ellie",
              color: "text-purple-600",
              href: "/dashboard/calls",
              bg: "bg-purple-50",
              icon: (
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="text-purple-500">
                  <path d="M17 13.5c-1.2 0-2.4-.2-3.5-.6a.94.94 0 00-1 .2l-2.2 2.2A14.1 14.1 0 014.7 9.7l2.2-2.2c.3-.3.4-.7.2-1C6.7 5.4 6.5 4.2 6.5 3c0-.6-.4-1-1-1H2.5c-.6 0-1 .4-1 1 0 8.3 6.7 15 15 15 .6 0 1-.4 1-1v-2.5c0-.6-.4-1-1-1z" fill="currentColor" />
                </svg>
              ),
            },
            {
              label: "Crisis Alerts",
              value: loading ? "--" : stats?.crisisAlerts ?? 0,
              sub: "flagged by Ellie",
              color: stats?.crisisAlerts ? "text-red-600" : "text-green-600",
              href: "/dashboard/crisis",
              bg: stats?.crisisAlerts ? "bg-red-50" : "bg-green-50",
              icon: (
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className={stats?.crisisAlerts ? "text-red-500" : "text-green-500"}>
                  <path d="M10 2L2 17h16L10 2z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                  <path d="M10 8v4M10 14v1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              ),
            },
          ].map((s) => (
            <Link
              key={s.label}
              href={s.href}
              className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 hover:shadow-md transition-shadow"
            >
              <div className={`w-9 h-9 rounded-lg ${s.bg} flex items-center justify-center mb-3`}>
                {s.icon}
              </div>
              <p className={`text-3xl font-bold ${s.color}`}>{s.value}</p>
              <p className="text-sm font-medium mt-1" style={{ color: '#1f375d' }}>{s.label}</p>
              <p className="text-xs text-gray-400 mt-0.5">{s.sub}</p>
            </Link>
          ))}
        </div>

        {/* Two-column: upcoming appointments + recent intakes */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Upcoming appointments */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-50">
              <h2 className="text-sm font-semibold" style={{ color: '#1f375d' }}>Today's Schedule</h2>
              <Link href="/dashboard/appointments" className="text-xs text-teal-600 hover:text-teal-700 font-medium">
                View all →
              </Link>
            </div>
            <div className="divide-y divide-gray-50">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="w-6 h-6 border-2 border-teal-200 border-t-teal-600 rounded-full animate-spin" />
                </div>
              ) : !stats?.upcomingAppointments?.length ? (
                <div className="py-10 text-center">
                  <p className="text-gray-400 text-sm">No appointments today</p>
                  <Link href="/dashboard/appointments" className="text-xs text-teal-600 mt-2 inline-block hover:text-teal-700">
                    Schedule one →
                  </Link>
                </div>
              ) : (
                stats.upcomingAppointments.map((appt) => (
                  <div key={appt.id} className="flex items-center gap-3 px-5 py-3">
                    <div className="text-right shrink-0 w-14">
                      <p className="text-xs font-semibold text-gray-700">{formatTime(appt.scheduled_at)}</p>
                      <p className="text-xs text-gray-400">{formatDateShort(appt.scheduled_at)}</p>
                    </div>
                    <div className="w-px h-8 bg-gray-100 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {appt.patient_name ?? "Unknown patient"}
                      </p>
                      <p className="text-xs text-gray-400 truncate">{appt.appointment_type}</p>
                    </div>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${
                        APPT_STATUS_COLORS[appt.status] ?? "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {appt.status.charAt(0).toUpperCase() + appt.status.slice(1)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Recent intake submissions */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-50">
              <h2 className="text-sm font-semibold" style={{ color: '#1f375d' }}>Recent Intakes</h2>
              <Link href="/dashboard/intake" className="text-xs text-teal-600 hover:text-teal-700 font-medium">
                View all →
              </Link>
            </div>
            <div className="divide-y divide-gray-50">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="w-6 h-6 border-2 border-teal-200 border-t-teal-600 rounded-full animate-spin" />
                </div>
              ) : !stats?.recentIntakes?.length ? (
                <div className="py-10 text-center">
                  <p className="text-gray-400 text-sm">No intake submissions yet</p>
                </div>
              ) : (
                stats.recentIntakes.map((intake) => (
                  <Link
                    key={intake.id}
                    href={`/dashboard/intake/${intake.id}`}
                    className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 transition-colors"
                  >
                    <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
                      <span className="text-xs font-semibold text-gray-500">
                        {(intake.patient_name ?? "?").charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {intake.patient_name ?? "Unknown"}
                      </p>
                      <p className="text-xs text-gray-400">
                        {intake.completed_at ? timeAgo(intake.completed_at) : "--"}
                      </p>
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      {intake.phq9_severity && (
                        <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${SEVERITY_COLORS[intake.phq9_severity] ?? "bg-gray-100 text-gray-600"}`}>
                          PHQ
                        </span>
                      )}
                      {intake.gad7_severity && (
                        <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${SEVERITY_COLORS[intake.gad7_severity] ?? "bg-gray-100 text-gray-600"}`}>
                          GAD
                        </span>
                      )}
                    </div>
                  </Link>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Recent Calls */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-50">
            <h2 className="text-sm font-semibold" style={{ color: '#1f375d' }}>Recent Calls</h2>
            <Link href="/dashboard/calls" className="text-xs text-teal-600 hover:text-teal-700 font-medium">
              View all →
            </Link>
          </div>
          <div className="divide-y divide-gray-50">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <div className="w-6 h-6 border-2 border-teal-200 border-t-teal-600 rounded-full animate-spin" />
              </div>
            ) : !stats?.recentCalls?.length ? (
              <div className="py-10 text-center">
                <p className="text-gray-400 text-sm">No calls yet</p>
                <p className="text-xs text-gray-300 mt-1">Calls Ellie handles will appear here</p>
              </div>
            ) : (
              stats.recentCalls.map((call) => (
                <Link
                  key={call.id}
                  href="/dashboard/calls"
                  className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 transition-colors"
                >
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                    call.crisis_detected ? "bg-red-100" : "bg-purple-100"
                  }`}>
                    <svg width="14" height="14" viewBox="0 0 20 20" fill="none" className={call.crisis_detected ? "text-red-600" : "text-purple-600"}>
                      <path d="M17 13.5c-1.2 0-2.4-.2-3.5-.6a.94.94 0 00-1 .2l-2.2 2.2A14.1 14.1 0 014.7 9.7l2.2-2.2c.3-.3.4-.7.2-1C6.7 5.4 6.5 4.2 6.5 3c0-.6-.4-1-1-1H2.5c-.6 0-1 .4-1 1 0 8.3 6.7 15 15 15 .6 0 1-.4 1-1v-2.5c0-.6-.4-1-1-1z" fill="currentColor" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-gray-900 truncate">{call.patient_name || call.patient_phone}</p>
                      {call.crisis_detected && (
                        <span className="text-xs px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 font-semibold">Crisis</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 truncate">
                      {stripMd(call.summary) || `${Math.floor(call.duration_seconds / 60)}m ${call.duration_seconds % 60}s call`}
                    </p>
                  </div>
                  <span className="text-xs text-gray-400 shrink-0">{timeAgo(call.created_at)}</span>
                </Link>
              ))
            )}
          </div>
        </div>

        {/* Quick action row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "New Appointment", href: "/dashboard/appointments", icon: "\u{1F4C5}" },
            { label: "View Patients", href: "/dashboard/patients", icon: "\u{1F464}" },
            { label: "Call Logs", href: "/dashboard/calls", icon: "\u{1F4DE}" },
            { label: "Practice Settings", href: "/dashboard/settings", icon: "\u{2699}\u{FE0F}" },
          ].map((action) => (
            <Link
              key={action.label}
              href={action.href}
              className="flex items-center gap-3 bg-white rounded-xl border border-gray-100 px-4 py-3 text-sm font-medium text-gray-700 hover:bg-teal-50 hover:border-teal-100 hover:text-teal-700 transition-colors shadow-sm"
            >
              <span className="text-lg">{action.icon}</span>
              {action.label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
