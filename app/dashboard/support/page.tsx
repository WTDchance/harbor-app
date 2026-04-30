"use client";

import { useState, useEffect, useCallback } from "react";

interface Ticket {
  id: string;
  subject: string;
  description: string;
  category: string;
  priority: string;
  status: string;
  page_url: string | null;
  created_at: string;
  updated_at: string;
  resolution: string | null;
}

const CATEGORIES = [
  { value: "voice_calls", label: "Phone Calls" },
  { value: "intake", label: "Intake Forms" },
  { value: "scheduling", label: "Scheduling" },
  { value: "billing", label: "Billing" },
  { value: "dashboard", label: "Dashboard" },
  { value: "sms", label: "Text Messages" },
  { value: "other", label: "Other" },
];

const PRIORITIES = [
  { value: "low", label: "Low", color: "#6b7280" },
  { value: "medium", label: "Medium", color: "#f59e0b" },
  { value: "high", label: "High", color: "#ef4444" },
  { value: "critical", label: "Critical", color: "#dc2626" },
];

const STATUS_LABELS: Record<string, { label: string; bg: string; text: string }> = {
  open: { label: "Open", bg: "#fef3c7", text: "#92400e" },
  in_progress: { label: "In Progress", bg: "#dbeafe", text: "#1e40af" },
  waiting: { label: "Waiting", bg: "#e0e7ff", text: "#4338ca" },
  resolved: { label: "Resolved", bg: "#d1fae5", text: "#065f46" },
  closed: { label: "Closed", bg: "#f3f4f6", text: "#6b7280" },
};

export default function SupportPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [submitting, setSubmitting] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Form state
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("other");
  const [priority, setPriority] = useState("medium");

  const fetchTickets = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      const res = await fetch(`/api/support?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setTickets(data.tickets || []);
        setTotal(data.total || 0);
      }
    } catch (err) {
      console.error("Failed to fetch tickets:", err);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    fetchTickets();
  }, [fetchTickets]);

  // Auto-refresh every 2 minutes
  useEffect(() => {
    const interval = setInterval(fetchTickets, 120000);
    return () => clearInterval(interval);
  }, [fetchTickets]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject.trim() || !description.trim()) return;
    setSubmitting(true);

    try {
      const res = await fetch("/api/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject,
          description,
          category,
          priority,
          page_url: window.location.href,
          browser_info: navigator.userAgent,
        }),
      });

      if (res.ok) {
        setSubject("");
        setDescription("");
        setCategory("other");
        setPriority("medium");
        setShowForm(false);
        fetchTickets();
      }
    } catch (err) {
      console.error("Failed to submit ticket:", err);
    } finally {
      setSubmitting(false);
    }
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const getCategoryLabel = (val: string) =>
    CATEGORIES.find((c) => c.value === val)?.label || val;

  const getPriorityInfo = (val: string) =>
    PRIORITIES.find((p) => p.value === val) || PRIORITIES[1];

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: "#1f2937", margin: 0 }}>Support</h1>
          <p style={{ color: "#6b7280", fontSize: 14, marginTop: 4 }}>
            Report issues and track their resolution
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          style={{
            background: "#0d9488",
            color: "white",
            border: "none",
            borderRadius: 8,
            padding: "10px 20px",
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {showForm ? "Cancel" : "Report a Problem"}
        </button>
      </div>

      {/* New Ticket Form */}
      {showForm && (
        <form
          onSubmit={handleSubmit}
          style={{
            background: "white",
            borderRadius: 12,
            padding: 24,
            marginBottom: 24,
            border: "1px solid #e5e7eb",
          }}
        >
          <h2 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 16px", color: "#1f2937" }}>
            Report a Problem
          </h2>

          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 4 }}>
              Subject
            </label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Brief description of the issue"
              required
              style={{
                width: "100%",
                padding: "10px 12px",
                border: "1px solid #d1d5db",
                borderRadius: 8,
                fontSize: 14,
                boxSizing: "border-box",
              }}
            />
          </div>

          <div style={{ display: "flex", gap: 16, marginBottom: 16 }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 4 }}>
                Category
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  border: "1px solid #d1d5db",
                  borderRadius: 8,
                  fontSize: 14,
                  background: "white",
                }}
              >
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 4 }}>
                Priority
              </label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  border: "1px solid #d1d5db",
                  borderRadius: 8,
                  fontSize: 14,
                  background: "white",
                }}
              >
                {PRIORITIES.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 4 }}>
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What happened? What did you expect to happen? Any steps to reproduce?"
              required
              rows={5}
              style={{
                width: "100%",
                padding: "10px 12px",
                border: "1px solid #d1d5db",
                borderRadius: 8,
                fontSize: 14,
                resize: "vertical",
                boxSizing: "border-box",
                fontFamily: "inherit",
              }}
            />
          </div>

          <button
            type="submit"
            disabled={submitting || !subject.trim() || !description.trim()}
            style={{
              background: submitting ? "#9ca3af" : "#0d9488",
              color: "white",
              border: "none",
              borderRadius: 8,
              padding: "10px 24px",
              fontSize: 14,
              fontWeight: 600,
              cursor: submitting ? "not-allowed" : "pointer",
            }}
          >
            {submitting ? "Submitting..." : "Submit Ticket"}
          </button>
        </form>
      )}

      {/* Filter tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {["all", "open", "in_progress", "resolved", "closed"].map((s) => (
          <button
            key={s}
            onClick={() => { setStatusFilter(s); setLoading(true); }}
            style={{
              padding: "6px 14px",
              borderRadius: 20,
              border: statusFilter === s ? "2px solid #0d9488" : "1px solid #d1d5db",
              background: statusFilter === s ? "#f0fdfa" : "white",
              color: statusFilter === s ? "#0d9488" : "#6b7280",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {s === "all" ? "All" : STATUS_LABELS[s]?.label || s}
          </button>
        ))}
      </div>

      {/* Tickets list */}
      {loading ? (
        <div style={{ textAlign: "center", padding: 40, color: "#9ca3af" }}>Loading tickets...</div>
      ) : tickets.length === 0 ? (
        <div
          style={{
            background: "white",
            borderRadius: 12,
            padding: 40,
            textAlign: "center",
            border: "1px solid #e5e7eb",
          }}
        >
          <p style={{ color: "#9ca3af", fontSize: 15, margin: 0 }}>
            {statusFilter === "all"
              ? "No support tickets yet. Click \"Report a Problem\" if something isn't working right."
              : `No ${STATUS_LABELS[statusFilter]?.label.toLowerCase() || statusFilter} tickets.`}
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {tickets.map((t) => {
            const status = STATUS_LABELS[t.status] || STATUS_LABELS.open;
            const pri = getPriorityInfo(t.priority);
            const isExpanded = expandedId === t.id;

            return (
              <div
                key={t.id}
                onClick={() => setExpandedId(isExpanded ? null : t.id)}
                style={{
                  background: "white",
                  borderRadius: 10,
                  padding: "16px 20px",
                  border: "1px solid #e5e7eb",
                  cursor: "pointer",
                  transition: "box-shadow 0.15s",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <span style={{ fontWeight: 600, fontSize: 15, color: "#1f2937" }}>{t.subject}</span>
                      <span
                        style={{
                          display: "inline-block",
                          fontSize: 11,
                          fontWeight: 600,
                          padding: "2px 8px",
                          borderRadius: 12,
                          background: status.bg,
                          color: status.text,
                        }}
                      >
                        {status.label}
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: 12, fontSize: 12, color: "#9ca3af" }}>
                      <span>{getCategoryLabel(t.category)}</span>
                      <span style={{ color: pri.color, fontWeight: 600 }}>{pri.label}</span>
                      <span>{formatDate(t.created_at)}</span>
                    </div>
                  </div>
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    fill="none"
                    style={{
                      transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
                      transition: "transform 0.2s",
                      marginTop: 4,
                    }}
                  >
                    <path d="M4 6l4 4 4-4" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </div>

                {isExpanded && (
                  <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #f3f4f6" }}>
                    <p style={{ fontSize: 14, color: "#374151", lineHeight: 1.6, margin: 0, whiteSpace: "pre-wrap" }}>
                      {t.description}
                    </p>
                    {t.resolution && (
                      <div
                        style={{
                          marginTop: 12,
                          padding: 12,
                          background: "#f0fdf4",
                          borderRadius: 8,
                          border: "1px solid #bbf7d0",
                        }}
                      >
                        <span style={{ fontSize: 12, fontWeight: 600, color: "#166534" }}>Resolution: </span>
                        <span style={{ fontSize: 13, color: "#166534" }}>{t.resolution}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {total > 50 && (
        <p style={{ textAlign: "center", color: "#9ca3af", fontSize: 13, marginTop: 16 }}>
          Showing {tickets.length} of {total} tickets
        </p>
      )}
    </div>
  );
}
