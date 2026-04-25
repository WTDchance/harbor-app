"use client";
// app/dashboard/audit-log/page.tsx
// HIPAA §164.312(b) — Audit Controls
// Displays a searchable, filterable log of all auth and PHI access events
// for the current practice.

import { useState, useEffect, useCallback } from "react";

interface AuditLog {
  id: string;
  timestamp: string;
  user_email: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  details: Record<string, any>;
  ip_address: string | null;
  severity: string;
}

const SEVERITY_STYLES: Record<string, string> = {
  info: "bg-blue-50 text-blue-700",
  warning: "bg-amber-50 text-amber-700",
  critical: "bg-red-50 text-red-700",
};

const ACTION_LABELS: Record<string, string> = {
  login: "Login",
  login_failed: "Failed Login",
  logout: "Logout",
  session_timeout: "Session Timeout",
  password_reset: "Password Reset",
  patient_view: "Patient Viewed",
  patient_update: "Patient Updated",
  call_log_view: "Call Log Viewed",
  settings_change: "Settings Changed",
  admin_impersonate: "Admin Impersonation",
  export_data: "Data Exported",
};

export default function AuditLogPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [actionFilter, setActionFilter] = useState("");
  const PAGE_SIZE = 50;

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(page * PAGE_SIZE),
      });
      if (actionFilter) params.set("action", actionFilter);

      const res = await fetch(`/api/audit-log?${params}`);
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs || []);
        setTotal(data.total || 0);
      }
    } catch {}
    setLoading(false);
  }, [page, actionFilter]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Audit Log</h1>
          <p className="text-sm text-gray-500 mt-1">
            HIPAA-compliant activity trail for your practice
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={actionFilter}
            onChange={(e) => {
              setActionFilter(e.target.value);
              setPage(0);
            }}
            className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white"
          >
            <option value="">All actions</option>
            {Object.entries(ACTION_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
          <button
            onClick={fetchLogs}
            className="text-sm px-3 py-2 rounded-lg border border-gray-200 hover:bg-gray-50"
          >
            Refresh
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="text-left px-4 py-3 font-medium text-gray-500">
                  Time
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">
                  Action
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">
                  User
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">
                  Resource
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">
                  IP Address
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">
                  Severity
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-gray-400">
                    Loading...
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-gray-400">
                    No audit events found
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr
                    key={log.id}
                    className="border-b border-gray-50 hover:bg-gray-50/50"
                  >
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                      {new Date(log.timestamp).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {ACTION_LABELS[log.action] || log.action}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {log.user_email || "—"}
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {log.resource_type
                        ? `${log.resource_type}${log.resource_id ? ` #${log.resource_id.slice(0, 8)}` : ""}`
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-gray-500 font-mono text-xs">
                      {log.ip_address || "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${SEVERITY_STYLES[log.severity] || "bg-gray-50 text-gray-600"}`}
                      >
                        {log.severity}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
            <span className="text-sm text-gray-500">
              {total} total events
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="px-3 py-1.5 rounded border border-gray-200 text-sm disabled:opacity-40 hover:bg-gray-50"
              >
                Previous
              </button>
              <span className="px-3 py-1.5 text-sm text-gray-600">
                Page {page + 1} of {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="px-3 py-1.5 rounded border border-gray-200 text-sm disabled:opacity-40 hover:bg-gray-50"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
