"use client";

// Wave 21: supabase-browser is now a no-op stub (returns empty arrays).
// Pages still call supabase.from() against it; full rewrite to AWS API
// fetches lands in Wave 23. Auth redirects are gone — pages render empty.
import { createClient } from '@/lib/supabase-browser'
const supabase = createClient()
// app/admin/patients/page.tsx
// Admin-only patient management — hard delete patients and all related records

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";


export default function AdminPatientsPage() {
  const router = useRouter();
  const [patients, setPatients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [search, setSearch] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [result, setResult] = useState<{ type: string; message: string } | null>(null);

  useEffect(() => {
    checkAdminAndLoad();
  }, []);

  async function checkAdminAndLoad() {
    // Wave 21: auth gate happens in middleware. Just hit the API.
    // Check admin status via API
    const res = await fetch("/api/auth/me");
    if (res.ok) {
      const data = await res.json();
      if (data.isAdmin) {
        setIsAdmin(true);
        await loadPatients();
      } else {
        router.push("/dashboard");
      }
    }
    setLoading(false);
  }

  async function loadPatients() {
    const { data, error } = await supabase
      .from("patients")
      .select("id, first_name, last_name, phone, email, created_at, practice_id")
      .order("created_at", { ascending: false })
      .limit(200);

    if (!error && data) setPatients(data);
  }

  async function handleDelete(patientId: string, patientName: string) {
    if (confirmId !== patientId) {
      setConfirmId(patientId);
      return;
    }

    setDeleting(patientId);
    setResult(null);
    try {
      const res = await fetch(`/api/admin/patients/${patientId}`, {
        method: "DELETE",
      });
      const data = await res.json();

      if (res.ok && data.success) {
        setResult({ type: "success", message: `Deleted ${patientName} and all related records` });
        setPatients((prev) => prev.filter((p) => p.id !== patientId));
      } else {
        setResult({ type: "error", message: data.error || "Delete failed" });
      }
    } catch (err) {
      setResult({ type: "error", message: "Network error" });
    }
    setDeleting(null);
    setConfirmId(null);
  }

  const filtered = patients.filter((p) => {
    const name = `${p.first_name || ""} ${p.last_name || ""}`.toLowerCase();
    const q = search.toLowerCase();
    return name.includes(q) || (p.phone || "").includes(q) || (p.email || "").toLowerCase().includes(q);
  });

  if (loading) return <div style={{ padding: 40, textAlign: "center" }}>Loading...</div>;
  if (!isAdmin) return <div style={{ padding: 40, textAlign: "center" }}>Access denied</div>;

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "24px 16px" }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>Admin: Patient Management</h1>
      <p style={{ color: "#666", marginBottom: 24, fontSize: 14 }}>
        Permanently delete patients and all related records. This action cannot be undone.
      </p>

      {result && (
        <div style={{
          padding: "12px 16px",
          borderRadius: 8,
          marginBottom: 16,
          background: result.type === "success" ? "#f0fdf4" : "#fef2f2",
          color: result.type === "success" ? "#166534" : "#991b1b",
          border: `1px solid ${result.type === "success" ? "#bbf7d0" : "#fecaca"}`,
        }}>
          {result.message}
        </div>
      )}

      <input
        type="text"
        placeholder="Search patients by name, phone, or email..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{
          width: "100%",
          padding: "10px 14px",
          borderRadius: 8,
          border: "1px solid #d1d5db",
          marginBottom: 16,
          fontSize: 14,
        }}
      />

      <div style={{ fontSize: 13, color: "#888", marginBottom: 12 }}>
        {filtered.length} patient{filtered.length !== 1 ? "s" : ""}
      </div>

      <div className="-mx-4 md:mx-0 overflow-x-auto">
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: "2px solid #e5e7eb", textAlign: "left" }}>
            <th style={{ padding: "8px 12px", fontSize: 13, fontWeight: 600 }}>Name</th>
            <th style={{ padding: "8px 12px", fontSize: 13, fontWeight: 600 }}>Phone</th>
            <th style={{ padding: "8px 12px", fontSize: 13, fontWeight: 600 }}>Email</th>
            <th style={{ padding: "8px 12px", fontSize: 13, fontWeight: 600 }}>Created</th>
            <th style={{ padding: "8px 12px", fontSize: 13, fontWeight: 600, textAlign: "right" }}>Action</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((p) => {
            const name = [p.first_name, p.last_name].filter(Boolean).join(" ") || "Unknown";
            const isConfirming = confirmId === p.id;
            const isDeleting = deleting === p.id;
            return (
              <tr key={p.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                <td style={{ padding: "10px 12px", fontSize: 14 }}>{name}</td>
                <td style={{ padding: "10px 12px", fontSize: 13, color: "#666" }}>{p.phone || "\u2014"}</td>
                <td style={{ padding: "10px 12px", fontSize: 13, color: "#666" }}>{p.email || "\u2014"}</td>
                <td style={{ padding: "10px 12px", fontSize: 13, color: "#888" }}>
                  {p.created_at ? new Date(p.created_at).toLocaleDateString() : "\u2014"}
                </td>
                <td style={{ padding: "10px 12px", textAlign: "right" }}>
                  <button
                    onClick={() => handleDelete(p.id, name)}
                    disabled={isDeleting}
                    style={{
                      padding: "6px 14px",
                      borderRadius: 6,
                      border: "none",
                      fontSize: 13,
                      fontWeight: 500,
                      cursor: isDeleting ? "wait" : "pointer",
                      background: isConfirming ? "#dc2626" : "#fef2f2",
                      color: isConfirming ? "#fff" : "#dc2626",
                    }}
                  >
                    {isDeleting ? "Deleting..." : isConfirming ? "Confirm Delete" : "Delete"}
                  </button>
                  {isConfirming && !isDeleting && (
                    <button
                      onClick={() => setConfirmId(null)}
                      style={{
                        marginLeft: 8,
                        padding: "6px 10px",
                        borderRadius: 6,
                        border: "1px solid #d1d5db",
                        background: "#fff",
                        fontSize: 13,
                        cursor: "pointer",
                      }}
                    >
                      Cancel
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>

      {filtered.length === 0 && (
        <div style={{ textAlign: "center", padding: 40, color: "#888" }}>
          {search ? "No patients match your search" : "No patients found"}
        </div>
      )}
    </div>
  );
}
