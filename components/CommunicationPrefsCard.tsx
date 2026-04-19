"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase-browser";

const supabase = createClient();

export interface CommunicationPrefs {
  sms_opted_out: boolean;
  email_opted_out: boolean;
  call_opted_out: boolean;
  phone: string | null;
  email: string | null;
}

type Channel = "sms" | "email" | "call";

interface Props {
  patientId: string;
  prefs: CommunicationPrefs | null;
  onChanged?: (prefs: CommunicationPrefs) => void;
}

// Dashboard card for flipping SMS / email / DNC per patient. Writes through
// /api/patients/[id]/communication-prefs which updates the per-channel
// opt-out tables. Show-only for channels where the patient has no identifier
// on file (e.g. no email → email toggle disabled with explanation).
export default function CommunicationPrefsCard({ patientId, prefs, onChanged }: Props) {
  const [saving, setSaving] = useState<Channel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [local, setLocal] = useState<CommunicationPrefs | null>(prefs);

  async function toggle(channel: Channel, nextValue: boolean) {
    if (!local) return;
    setError(null);
    setSaving(channel);

    // Optimistic update so the switch responds instantly; rolled back on failure.
    const previous = local;
    const optimistic: CommunicationPrefs = { ...local };
    if (channel === "sms") optimistic.sms_opted_out = nextValue;
    if (channel === "email") optimistic.email_opted_out = nextValue;
    if (channel === "call") optimistic.call_opted_out = nextValue;
    setLocal(optimistic);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setError("Session expired — please log in again.");
        setLocal(previous);
        setSaving(null);
        return;
      }
      const body: Record<string, boolean> = {};
      if (channel === "sms") body.sms_opted_out = nextValue;
      if (channel === "email") body.email_opted_out = nextValue;
      if (channel === "call") body.call_opted_out = nextValue;

      const res = await fetch(`/api/patients/${patientId}/communication-prefs`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.error || `Failed to update (${res.status})`);
        setLocal(previous);
        setSaving(null);
        return;
      }
      const next: CommunicationPrefs = {
        sms_opted_out: !!json.sms_opted_out,
        email_opted_out: !!json.email_opted_out,
        call_opted_out: !!json.call_opted_out,
        phone: json.phone ?? previous.phone,
        email: json.email ?? previous.email,
      };
      setLocal(next);
      onChanged?.(next);
    } catch (err: any) {
      setError(err?.message || "Request failed");
      setLocal(previous);
    } finally {
      setSaving(null);
    }
  }

  if (!local) {
    return (
      <div className="bg-white border rounded-lg p-5 shadow-sm text-sm text-gray-500">
        Communication preferences unavailable.
      </div>
    );
  }

  const rows: Array<{
    channel: Channel;
    label: string;
    identifier: string | null;
    optedOut: boolean;
    note?: string;
  }> = [
    {
      channel: "sms",
      label: "Text messages",
      identifier: local.phone,
      optedOut: local.sms_opted_out,
      note: "Also auto-toggled off when a patient replies STOP.",
    },
    {
      channel: "email",
      label: "Email",
      identifier: local.email,
      optedOut: local.email_opted_out,
    },
    {
      channel: "call",
      label: "Phone calls",
      identifier: local.phone,
      optedOut: local.call_opted_out,
      note: "Reserved — Harbor only answers inbound calls today. Applied if outbound calling ships.",
    },
  ];

  return (
    <div className="bg-white border rounded-lg p-5 shadow-sm">
      <h2 className="font-semibold text-gray-900 mb-3">Communication</h2>

      <div className="divide-y">
        {rows.map((row) => (
          <Row
            key={row.channel}
            label={row.label}
            identifier={row.identifier}
            optedOut={row.optedOut}
            saving={saving === row.channel}
            note={row.note}
            onToggle={(v) => toggle(row.channel, v)}
          />
        ))}
      </div>

      {error && (
        <div className="mt-3 text-xs text-red-700 bg-red-50 rounded p-2">{error}</div>
      )}
    </div>
  );
}

function Row({
  label,
  identifier,
  optedOut,
  saving,
  note,
  onToggle,
}: {
  label: string;
  identifier: string | null;
  optedOut: boolean;
  saving: boolean;
  note?: string;
  onToggle: (next: boolean) => void;
}) {
  const disabled = !identifier;
  // Toggle convention: ON (green) = patient can receive; OFF (gray) = opted out.
  // This is more natural to therapists than "on = opted out."
  const on = !optedOut;

  return (
    <div className="py-3 flex items-start justify-between gap-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-900">{label}</span>
          {optedOut && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-medium">
              Opted out
            </span>
          )}
        </div>
        <div className="text-xs text-gray-500 mt-0.5 truncate">
          {identifier || "No contact method on file"}
        </div>
        {note && <div className="text-xs text-gray-400 mt-1">{note}</div>}
      </div>
      <button
        type="button"
        onClick={() => !disabled && !saving && onToggle(!optedOut ? true : false)}
        disabled={disabled || saving}
        role="switch"
        aria-checked={on}
        aria-label={`${label} ${on ? "enabled" : "disabled"}`}
        className={`relative inline-flex flex-shrink-0 h-6 w-11 mt-1 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-teal-500 ${
          disabled
            ? "bg-gray-200 cursor-not-allowed"
            : on
            ? "bg-teal-600"
            : "bg-gray-300"
        }`}
      >
        <span
          className={`inline-block h-5 w-5 bg-white rounded-full transform transition-transform shadow ring-0 mt-0.5 ${
            on ? "translate-x-5" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}
